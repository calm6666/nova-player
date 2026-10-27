/**
 * ============================================
 * Lumina 响应式信号核心（signalsCore）
 * ============================================
 * 提供框架底层的细粒度响应式原语：
 * - signal：可读可写的普通信号
 * - computed：惰性求值、自动缓存、失去订阅后自动退订的计算信号
 * - effect：订阅信号变化并自动重跑的副作用
 * - batch / untracked / action：批量提交、快照读取、动作包装
 * - createModel：把信号与动作组织为可统一销毁的模型
 *
 * 设计说明：
 * - 本模块演化自 @preact/signals-core 的成熟设计，已本地化为自研内核
 *   （品牌标记为 Symbol.for("lumina-signals")），仓库不再依赖任何外部响应式库
 * - 依赖图使用双向链表 + 单调递增版本号实现 O(1) 依赖收集与精准更新；
 *   未被引用的 computed 子图在失去全部订阅者后可被垃圾回收
 * - Signal / Computed / Effect 采用「declare class 类型声明 + ES5 原型实现」
 *   双轨模式以精确控制转译产物体积；文件内的少量 as 断言仅服务于该模式
 */

// 全局品牌标记：即使 Signal 实例并非由同一份 signals 库创建（多副本场景），
// 也能通过 Symbol.for 注册的全局符号可靠识别
const BRAND_SYMBOL = Symbol.for("lumina-signals");

// Computed 与 Effect 的状态标志位
const RUNNING = 1 << 0;
const NOTIFIED = 1 << 1;
const OUTDATED = 1 << 2;
const DISPOSED = 1 << 3;
const HAS_ERROR = 1 << 4;
const TRACKING = 1 << 5;

// 双向链表节点：同时承担依赖（source 侧）与订阅者（target 侧）的追踪，
// 并记录 target 最近一次观察到的 source 版本号
type Node = {
	// target 所依赖的 source（即被读取的 Signal）
	_source: Signal;
	_prevSource?: Node;
	_nextSource?: Node;

	// 依赖 source 的 target（Computed 或 Effect），source 变化时需通知它
	_target: Computed | Effect;
	_prevTarget?: Node;
	_nextTarget?: Node;

	// target 最近一次看到的 source 版本号。使用版本号而非缓存值的原因：
	// source 的值可能占用任意大的内存，而 computed 是惰性求值，
	// 缓存值可能被其无限期持有导致无法回收。
	// 特殊值 -1 用于标记「可能已不再使用、但可回收复用」的节点
	_version: number;

	// 进入/退出新的求值上下文时，记录并回滚 source 上原先的 `._node` 值
	_rollbackNode?: Node;
};

function startBatch(): void {
	batchDepth++;
}

function endBatch(): void {
	if (batchDepth > 1) {
		batchDepth--;
		return;
	}

	let error: unknown;
	let hasError = false;
	reconcileBatchSnapshots();

	while (batchedEffect !== undefined) {
		let effect: Effect | undefined = batchedEffect;
		batchedEffect = undefined;

		batchIteration++;

		while (effect !== undefined) {
			const next: Effect | undefined = effect._nextBatchedEffect;
			effect._nextBatchedEffect = undefined;
			effect._flags &= ~NOTIFIED;

			if (!(effect._flags & DISPOSED) && needsToRecompute(effect)) {
				try {
					effect._callback();
				} catch (err) {
					if (!hasError) {
						error = err;
						hasError = true;
					}
				}
			}
			effect = next;
		}
	}
	batchIteration = 0;
	batchDepth--;

	if (hasError) {
		throw error;
	}
}

/**
 * 将多次信号写入合并为一次「提交」，在回调结束后统一刷新。
 *
 * batch 可以嵌套，只有最外层 batch 的回调结束时才会真正刷新变更。
 *
 * 在 batch 内部读取已被修改的信号，能立即读到更新后的值。
 *
 * @param fn - 回调函数
 * @returns 回调函数的返回值
 */
function batch<T>(fn: () => T): T {
	if (batchDepth > 0) {
		return fn();
	}
	currentBatchSnapshotVersion = ++batchSnapshotVersion;
	/*@__INLINE__**/ startBatch();
	try {
		return fn();
	} finally {
		endBatch();
	}
}

// 当前正在求值的 computed 或 effect（依赖收集的运行上下文）
let evalContext: Computed | Effect | undefined = undefined;

// createModel 工厂执行期间捕获到的 effect 列表（由模型统一持有和销毁）
let capturedEffects: Effect[] | undefined;

/**
 * 在不建立依赖订阅的前提下读取信号值（快照语义）。
 *
 * 若在 `createModel` 工厂内调用，还会顺带屏蔽「模型托管 effect 捕获」：
 * 回调内新建的 effect 不会归属外层模型，需调用方自行销毁；
 * 回调内嵌套的 `createModel` 仍然正常捕获自己的 effect。
 *
 * @param fn - 回调函数
 * @returns 回调函数的返回值
 */
function untracked<T>(fn: () => T): T {
	const prevContext = evalContext;
	const prevCapturedEffects = capturedEffects;

	evalContext = undefined;
	// 模型 effect 捕获是另一种形式的隐式追踪：在 untracked 回调中将其屏蔽，
	// 同时允许嵌套的 createModel() 建立自己的捕获作用域
	capturedEffects = undefined;
	try {
		return fn();
	} finally {
		evalContext = prevContext;
		capturedEffects = prevCapturedEffects;
	}
}

// 当前批次内收集、待统一刷新的 effect（链表头）
let batchedEffect: Effect | undefined = undefined;
let batchDepth = 0;
let batchIteration = 0;

type BatchSnapshot = {
	_source: Signal;
	_value: unknown;
	_version: number;
	_next?: BatchSnapshot;
};

let batchSnapshotVersion = 0;
let currentBatchSnapshotVersion = 0;
let batchSnapshots: BatchSnapshot | undefined = undefined;

// 信号全局版本号：当全局无任何变化时，让重复的 computed.peek()/computed.value
// 读取走快速路径（跳过逐依赖比对）
let globalVersion = 0;

function recordBatchSnapshot(source: Signal): void {
	// 仅在用户可见的 batch 回调执行期间捕获写入，effect 刷新阶段不捕获
	if (batchDepth === 0 || batchIteration !== 0) {
		return;
	}

	if (source._batchSnapshotVersion !== currentBatchSnapshotVersion) {
		source._batchSnapshotVersion = currentBatchSnapshotVersion;
		batchSnapshots = {
			_source: source,
			_value: source._value,
			_version: source._version,
			_next: batchSnapshots,
		};
	}
}

function reconcileBatchSnapshots(): void {
	let snapshots = batchSnapshots;
	batchSnapshots = undefined;

	while (snapshots !== undefined) {
		const source = snapshots._source;
		if (source._value === snapshots._value) {
			// 值在批次结束后回到了批次前的状态。版本号必须保持单调递增：
			// 惰性 computed 可能在批次中途观察到中间版本号，若把版本号回滚，
			// 未来的写入就可能重新产出「已被观察过的版本号」且对应不同的值，
			// 导致该 computed 永远误判「未变化」。因此这里改为把最后观察到
			// 批次前版本的订阅者直接快进到最新版本，跳过这次无效变更的重算。
			for (
				let node = source._targets;
				node !== undefined;
				node = node._nextTarget
			) {
				if (node._version === snapshots._version) {
					node._version = source._version;
				}
			}
		}
		snapshots = snapshots._next;
	}
}

function addDependency(signal: Signal): Node | undefined {
	if (evalContext === undefined) {
		return undefined;
	}

	let node = signal._node;
	if (node === undefined || node._target !== evalContext) {
		/**
		 * `signal` 是一个新依赖：创建新的依赖节点，
		 * 并接到当前上下文依赖链表的尾部。如：
		 *
		 * { A <-> B       }
		 *         ↑     ↑
		 *        tail  node（新建）
		 *               ↓
		 * { A <-> B <-> C }
		 *               ↑
		 *              tail（即 evalContext._sources）
		 */
		node = {
			_version: 0,
			_source: signal,
			_prevSource: evalContext._sources,
			_nextSource: undefined,
			_target: evalContext,
			_prevTarget: undefined,
			_nextTarget: undefined,
			_rollbackNode: node,
		};

		if (evalContext._sources !== undefined) {
			evalContext._sources._nextSource = node;
		}
		evalContext._sources = node;
		signal._node = node;

		// 若当前处于 effect 中，或正在求值的 computed 自身也有订阅者，
		// 则向该依赖订阅变更通知
		if (evalContext._flags & TRACKING) {
			signal._subscribe(node);
		}
		return node;
	} else if (node._version === -1) {
		// `signal` 是上一次求值留下的旧依赖：复用该节点
		node._version = 0;

		/**
		 * 若 `node` 还不是依赖链表的当前尾节点（即它存在后继节点），
		 * 则把 `node` 挪到链表尾部成为新的尾节点。如：
		 *
		 * { A <-> B <-> C <-> D }
		 *         ↑           ↑
		 *        node   ┌─── tail（evalContext._sources）
		 *         └─────│─────┐
		 *               ↓     ↓
		 * { A <-> C <-> D <-> B }
		 *                     ↑
		 *                    tail（evalContext._sources）
		 */
		if (node._nextSource !== undefined) {
			node._nextSource._prevSource = node._prevSource;

			if (node._prevSource !== undefined) {
				node._prevSource._nextSource = node._nextSource;
			}

			node._prevSource = evalContext._sources;
			node._nextSource = undefined;

			evalContext._sources!._nextSource = node;
			evalContext._sources = node;
		}

		// 能走到这里说明当前求值的 effect / computed 已经按需订阅了 `signal` 的变更通知
		return node;
	}
	return undefined;
}

//#region 信号 Signal

/**
 * 普通 Signal 与 Computed Signal 的基类（类型声明）。
 */
//
// 文件后面存在同名函数实现，需忽略 TypeScript 的重复声明告警：
// 类型先用 declare class 声明，实现则延后用 ES5 风格的原型方式完成，
// 以便精确控制转译产物的体积。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare class Signal<T = unknown> {
	/** @internal */
	_value: unknown;

	/**
	 * @internal
	 * 版本号必须始终 >= 0：特殊值 -1 被保留给 Node，
	 * 用于标记「可能已不再使用、但可回收复用」的节点
	 */
	_version: number;

	/** @internal */
	_node?: Node;

	/** @internal */
	_targets?: Node;

	/** @internal */
	_batchSnapshotVersion: number;

	constructor(value?: T, options?: SignalOptions<T>);

	/** @internal */
	_refresh(): boolean;

	/** @internal */
	_subscribe(node: Node): void;

	/** @internal */
	_unsubscribe(node: Node): void;

	/** @internal */
	_watched?(this: Signal<T>): void;

	/** @internal */
	_unwatched?(this: Signal<T>): void;

	subscribe(fn: (value: T) => void): () => void;

	name?: string;

	valueOf(): T;

	toString(): string;

	toJSON(): T;

	peek(): T;

	brand: typeof BRAND_SYMBOL;

	get value(): T;
	set value(value: T);
}

export interface SignalOptions<T = unknown> {
	watched?: (this: Signal<T>) => void;
	unwatched?: (this: Signal<T>) => void;
	name?: string;
}

/** @internal */
// 前面已声明同名 class，这里需忽略 TypeScript 的重复声明告警：
// 上面声明的 class 在此用 ES5 风格的原型方式实现，
// 以便精确控制转译产物的体积。
function Signal(this: Signal, value?: unknown, options?: SignalOptions): void {
	this._value = value;
	this._version = 0;
	this._node = undefined;
	this._targets = undefined;
	this._batchSnapshotVersion = 0;
	this._watched = options?.watched;
	this._unwatched = options?.unwatched;
	this.name = options?.name;
}

Signal.prototype.brand = BRAND_SYMBOL;

Signal.prototype._refresh = function (): boolean {
	return true;
};

Signal.prototype._subscribe = function (node): void {
	const targets = this._targets;
	if (targets !== node && node._prevTarget === undefined) {
		node._nextTarget = targets;
		this._targets = node;

		if (targets !== undefined) {
			targets._prevTarget = node;
		} else {
			untracked(() => {
				this._watched?.call(this);
			});
		}
	}
};

Signal.prototype._unsubscribe = function (node): void {
	// 仅当信号还存在订阅者时才执行退订收尾
	if (this._targets !== undefined) {
		const prev = node._prevTarget;
		const next = node._nextTarget;
		if (prev !== undefined) {
			prev._nextTarget = next;
			node._prevTarget = undefined;
		}

		if (next !== undefined) {
			next._prevTarget = prev;
			node._nextTarget = undefined;
		}

		if (node === this._targets) {
			this._targets = next;
			if (next === undefined) {
				untracked(() => {
					this._unwatched?.call(this);
				});
			}
		}
	}
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
Signal.prototype.subscribe = function (fn) {
	return effect(
		() => {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			const value = this.value;
			untracked(() => fn(value));
		},
		{ name: "sub" }
	);
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
Signal.prototype.valueOf = function () {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-return
	return this.value;
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
Signal.prototype.toString = function () {
	return this.value + "";
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
Signal.prototype.toJSON = function () {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-return
	return this.value;
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
Signal.prototype.peek = function () {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-return
	return untracked(() => this.value);
};

Object.defineProperty(Signal.prototype, "value", {
	get(this: Signal) {
		const node = addDependency(this);
		if (node !== undefined) {
			node._version = this._version;
		}
		return this._value;
	},
	set(this: Signal, value) {
		if (value !== this._value) {
			if (batchIteration > 100) {
				throw new Error("Cycle detected");
			}

			recordBatchSnapshot(this);
			this._value = value;
			this._version++;
			globalVersion++;

			/**@__INLINE__*/ startBatch();
			try {
				for (
					let node = this._targets;
					node !== undefined;
					node = node._nextTarget
				) {
					node._target._notify();
				}
			} finally {
				endBatch();
			}
		}
	},
});

/**
 * 创建一个新的普通信号（可读可写）。
 *
 * @param value - 信号初始值
 * @returns 新的 Signal 实例
 */
export function signal<T>(value: T, options?: SignalOptions<T>): Signal<T>;
export function signal<T = undefined>(): Signal<T | undefined>;
export function signal<T>(value?: T, options?: SignalOptions<T>): Signal<T> {
	return new Signal(value, options);
}

//#endregion 信号 Signal

//#region 计算属性 Computed

function needsToRecompute(target: Computed | Effect): boolean {
	// 检查依赖是否有值变化。依赖链表本身就是按使用顺序排列的，
	// 因此即使多个依赖都变了，这里也只会先触发最靠前的那个依赖的刷新。
	for (
		let node = target._sources;
		node !== undefined;
		node = node._nextSource
	) {
		if (
			// 若依赖的版本号在最后一次被观察之后确定已更新，则需要重算。
			// 该检查并非正确性所必需，但能在依赖已更新时跳过后续 refresh 调用
			node._source._version !== node._version ||
			// 刷新依赖。若刷新被阻断（如存在依赖环），则需要重算
			!node._source._refresh() ||
			// 若刷新后依赖获得了新版本号，则需要重算
			node._source._version !== node._version
		) {
			return true;
		}
	}
	// 所有依赖自上次重算以来都没有变化，无需重算
	return false;
}

function prepareSources(target: Computed | Effect): void {
	/**
	 * 1. 把现有全部依赖节点标记为可复用（version: -1）
	 * 2. 若节点正被其它上下文使用，记录回滚节点
	 * 3. 把 'target._sources' 指向双向链表的尾节点，如：
	 *
	 *    { undefined <- A <-> B <-> C -> undefined }
	 *                   ↑           ↑
	 *                   │           └──────┐
	 * target._sources = A;（node 为头）   │
	 *                   ↓                  │
	 * target._sources = C;（node 为尾）  ─┘
	 */
	for (
		let node = target._sources;
		node !== undefined;
		node = node._nextSource
	) {
		const rollbackNode = node._source._node;
		if (rollbackNode !== undefined) {
			node._rollbackNode = rollbackNode;
		}
		node._source._node = node;
		node._version = -1;

		if (node._nextSource === undefined) {
			target._sources = node;
			break;
		}
	}
}

function cleanupSources(target: Computed | Effect): void {
	let node = target._sources;
	let head: Node | undefined = undefined;

	/**
	 * 此时 'target._sources' 已指向双向链表尾节点，
	 * 链表中按使用顺序包含全部旧依赖 + 新依赖。
	 * 从尾向头遍历找到头节点，同时丢弃本次未被复用的旧依赖。
	 */
	while (node !== undefined) {
		const prev = node._prevSource;

		/**
		 * 节点未被复用：退订其变更通知，并从双向链表中移除自身。如：
		 *
		 * { A <-> B <-> C }
		 *         ↓
		 *    { A <-> C }
		 */
		if (node._version === -1) {
			node._source._unsubscribe(node);

			if (prev !== undefined) {
				prev._nextSource = node._nextSource;
			}
			if (node._nextSource !== undefined) {
				node._nextSource._prevSource = prev;
			}
		} else {
			/**
			 * 新的头节点 = 遍历中最后一个未被移除/退订的节点。如：
			 *
			 * { A <-> B <-> C }
			 *   ↑     ↑     ↑
			 *   │     │     └ head = node
			 *   │     └ head = node
			 *   └ head = node
			 */
			head = node;
		}

		node._source._node = node._rollbackNode;
		if (node._rollbackNode !== undefined) {
			node._rollbackNode = undefined;
		}

		node = prev;
	}

	target._sources = head;
}

/**
 * 计算信号（computed signal）的基类（类型声明）。
 */
declare class Computed<T = unknown> extends Signal<T> {
	_fn: () => T;
	_sources?: Node;
	_globalVersion: number;
	_flags: number;

	constructor(fn: () => T, options?: SignalOptions<T>);

	_notify(): void;
	get value(): T;
}

/** @internal */
function Computed(this: Computed, fn: () => unknown, options?: SignalOptions): void {
	Signal.call(this, undefined, options);

	this._fn = fn;
	this._sources = undefined;
	this._globalVersion = globalVersion - 1;
	this._flags = OUTDATED;
}

Computed.prototype = new Signal() as Computed;

Computed.prototype._refresh = function (): boolean {
	this._flags &= ~NOTIFIED;

	if (this._flags & RUNNING) {
		return false;
	}

	// 若该 computed 已订阅其依赖的更新（TRACKING 标志位置位），
	// 且没有任何依赖通知过变更（OUTDATED 标志位未置位），
	// 则计算值不可能发生变化
	if ((this._flags & (OUTDATED | TRACKING)) === TRACKING) {
		return true;
	}
	this._flags &= ~OUTDATED;

	if (this._globalVersion === globalVersion) {
		return true;
	}
	this._globalVersion = globalVersion;

	// 在检查依赖值变化之前先标记 RUNNING，
	// 这样依赖环会在后续求值中被 RUNNING 标志识别出来
	this._flags |= RUNNING;
	if (this._version > 0 && !needsToRecompute(this)) {
		this._flags &= ~RUNNING;
		return true;
	}

	const prevContext = evalContext;
	try {
		prepareSources(this);
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		evalContext = this;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const value = this._fn();
		if (
			this._flags & HAS_ERROR ||
			this._value !== value ||
			this._version === 0
		) {
			this._value = value;
			this._flags &= ~HAS_ERROR;
			this._version++;
		}
	} catch (err) {
		this._value = err;
		this._flags |= HAS_ERROR;
		this._version++;
	}
	evalContext = prevContext;
	cleanupSources(this);
	this._flags &= ~RUNNING;
	return true;
};

Computed.prototype._subscribe = function (node: Node): void {
	if (this._targets === undefined) {
		this._flags |= OUTDATED | TRACKING;

		// computed 信号在获得第一个订阅者时才惰性订阅自己的依赖
		for (
			let node = this._sources;
			node !== undefined;
			node = node._nextSource
		) {
			node._source._subscribe(node);
		}
	}
	Signal.prototype._subscribe.call(this, node);
};

Computed.prototype._unsubscribe = function (node: Node): void {
	// 仅当该 computed 信号还存在订阅者时才执行退订收尾
	if (this._targets !== undefined) {
		Signal.prototype._unsubscribe.call(this, node);

		// computed 信号在失去最后一个订阅者时同时退订自己的依赖，
		// 使得不再被引用的 computed 子图能够被垃圾回收
		if (this._targets === undefined) {
			this._flags &= ~TRACKING;

			for (
				let node = this._sources;
				node !== undefined;
				node = node._nextSource
			) {
				node._source._unsubscribe(node);
			}
		}
	}
};

Computed.prototype._notify = function (): void {
	if (!(this._flags & NOTIFIED)) {
		this._flags |= OUTDATED | NOTIFIED;

		for (
			let node = this._targets;
			node !== undefined;
			node = node._nextTarget
		) {
			node._target._notify();
		}
	}
};

Object.defineProperty(Computed.prototype, "value", {
	get(this: Computed) {
		if (this._flags & RUNNING) {
			throw new Error("Cycle detected");
		}
		const node = addDependency(this);
		this._refresh();
		if (node !== undefined) {
			node._version = this._version;
		}
		if (this._flags & HAS_ERROR) {
			throw this._value;
		}
		return this._value;
	},
});

/**
 * 只读信号接口（computed 的返回类型）。
 */
interface ReadonlySignal<T = unknown> {
	readonly value: T;
	peek(): T;

	subscribe(fn: (value: T) => void): () => void;
	valueOf(): T;
	toString(): string;
	toJSON(): T;
	brand: typeof BRAND_SYMBOL;
}

/**
 * 基于其它信号值创建一个新的计算信号。
 *
 * 返回的 computed 信号是只读的：回调内访问到的任何信号发生变化时，
 * 其值都会自动重新计算（惰性求值 + 订阅者驱动）。
 *
 * @param fn - 计算函数，返回计算值
 * @returns 新的只读信号
 */
function computed<T>(
	fn: () => T,
	options?: SignalOptions<T>
): ReadonlySignal<T> {
	return new Computed(fn, options);
}

//#endregion 计算属性 Computed

//#region 副作用 Effect

function cleanupEffect(effect: Effect): void {
	const cleanup = effect._cleanup;
	effect._cleanup = undefined;

	if (typeof cleanup === "function") {
		/*@__INLINE__**/ startBatch();

		// 清理函数始终在任何求值上下文之外执行
		const prevContext = evalContext;
		evalContext = undefined;
		try {
			cleanup();
		} catch (err) {
			effect._flags &= ~RUNNING;
			effect._flags |= DISPOSED;
			disposeEffect(effect);
			throw err;
		} finally {
			evalContext = prevContext;
			endBatch();
		}
	}
}

function disposeEffect(effect: Effect): void {
	for (
		let node = effect._sources;
		node !== undefined;
		node = node._nextSource
	) {
		node._source._unsubscribe(node);
	}
	effect._fn = undefined;
	effect._sources = undefined;

	cleanupEffect(effect);
}

function endEffect(this: Effect, prevContext?: Computed | Effect): void {
	if (evalContext !== this) {
		throw new Error("Out-of-order effect");
	}
	cleanupSources(this);
	evalContext = prevContext;

	this._flags &= ~RUNNING;
	if (this._flags & DISPOSED) {
		disposeEffect(this);
	}
	endBatch();
}

type EffectFn =
	| ((this: { dispose: () => void }) => void | (() => void))
	| (() => void | (() => void));

// 避免强依赖消费方 tsconfig 开启 ESNext.Disposable lib：
// 当 `Symbol.dispose` 可用时，它就是以该 symbol 为键的销毁器类型；否则为 never
type DisposeSymbol = typeof Symbol extends { readonly dispose: infer TDispose }
	? TDispose
	: never;
type DisposableLike = {
	[K in DisposeSymbol & PropertyKey]: () => void;
};
type DisposeFn = (() => void) & DisposableLike;

/**
 * 响应式副作用（effect）的基类（类型声明）。
 */
declare class Effect {
	_fn?: EffectFn;
	_cleanup?: () => void;
	_sources?: Node;
	_nextBatchedEffect?: Effect;
	_flags: number;
	_debugCallback?: () => void;
	name?: string;

	constructor(fn: EffectFn, options?: EffectOptions);

	_callback(): void;
	_start(): () => void;
	_notify(): void;
	_dispose(): void;
	dispose(): void;
}

export interface EffectOptions {
	name?: string;
}

/** @internal */
function Effect(this: Effect, fn: EffectFn, options?: EffectOptions): void {
	this._fn = fn;
	this._cleanup = undefined;
	this._sources = undefined;
	this._nextBatchedEffect = undefined;
	this._flags = TRACKING;
	this.name = options?.name;

	if (capturedEffects) {
		capturedEffects.push(this);
	}
}

Effect.prototype._callback = function (): void {
	const finish = this._start();
	try {
		if (this._flags & DISPOSED) return;
		if (this._fn === undefined) return;

		const cleanup = this._fn();
		if (typeof cleanup === "function") {
			this._cleanup = cleanup;
		}
	} finally {
		finish();
	}
};

Effect.prototype._start = function (): () => void {
	if (this._flags & RUNNING) {
		throw new Error("Cycle detected");
	}
	this._flags |= RUNNING;
	this._flags &= ~DISPOSED;
	cleanupEffect(this);
	prepareSources(this);

	/*@__INLINE__**/ startBatch();
	const prevContext = evalContext;
	// eslint-disable-next-line @typescript-eslint/no-this-alias
	evalContext = this;
	return endEffect.bind(this, prevContext);
};

Effect.prototype._notify = function (): void {
	if (!(this._flags & NOTIFIED)) {
		this._flags |= NOTIFIED;
		this._nextBatchedEffect = batchedEffect;
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		batchedEffect = this;
	}
};

Effect.prototype._dispose = function (): void {
	this._flags |= DISPOSED;

	if (!(this._flags & RUNNING)) {
		disposeEffect(this);
	}
};

Effect.prototype.dispose = function (): void {
	this._dispose();
};
/**
 * 创建一个副作用：当回调内访问到的信号发生变化时自动重新执行。
 *
 * effect 会追踪回调函数 `fn` 中访问了哪些信号，并在这些信号变化时重跑回调。
 *
 * 回调可以返回一个清理函数：该清理函数只会执行一次——
 * 在回调下一次执行前、或 effect 被销毁时（以先发生者为准）。
 *
 * @param fn - 副作用回调
 * @returns 用于销毁该 effect 的函数
 */
function effect(fn: EffectFn, options?: EffectOptions): DisposeFn {
	const effect = new Effect(fn, options);
	try {
		effect._callback();
	} catch (err) {
		effect._dispose();
		throw err;
	}
	// 返回 bind 后的函数而非 `() => effect._dispose()` 这类包装器：
	// bind 函数的性能与之相当，但内存占用小得多
	const dispose = effect._dispose.bind(effect);
	(dispose as DisposeFn)[Symbol.dispose] = dispose;
	return dispose as DisposeFn;
}

//#endregion 副作用 Effect

//#region 动作 Action

function action<TArgs extends unknown[], TReturn>(
	fn: (...args: TArgs) => TReturn
): (...args: TArgs) => TReturn {
	return function actionWrapper(this: unknown, ...args: TArgs) {
		return batch(() => untracked(() => fn.apply(this, args)));
	};
}

//#endregion 动作 Action

//#region 模型 createModel

/** 模型只能包含信号、动作，以及仅由信号和动作构成的嵌套对象 */
type ValidateModel<TModel> = {
	[Key in keyof TModel]: TModel[Key] extends ReadonlySignal<unknown>
		? TModel[Key]
		: TModel[Key] extends (...args: unknown[]) => unknown
			? TModel[Key]
			: TModel[Key] extends object
				? ValidateModel<TModel[Key]>
				: `Property ${Key extends string ? `'${Key}' ` : ""}is not a Signal, Action, or an object that contains only Signals and Actions.`;
};

export type Model<TModel> = ValidateModel<TModel> & DisposableLike;

export type ModelFactory<TModel, TFactoryArgs extends unknown[] = []> = (
	...args: TFactoryArgs
) => ValidateModel<TModel>;
export type ModelConstructor<TModel, TFactoryArgs extends unknown[] = []> = new (
	...args: TFactoryArgs
) => Model<TModel>;

/**
 * ModelConstructor 的公开类型要求用 `new` 调用，以便区分传入 `createModel`
 * 的工厂函数与返回的构造函数。说「createModel 接收工厂并返回一个类」
 * 比说「接收工厂并返回一个工厂」更易于理解。换言之，下面这个例子：
 *
 * ```ts
 * const PersonModel = createModel((name: string) => ({ ... }));
 * const person = new PersonModel("John");
 * ```
 *
 * 比下面这个例子更好理解：
 *
 * ```ts
 * const createPerson = createModel((name: string) => ({ ... }));
 * const person = createPerson("John");
 * ```
 *
 * 但内部实现上，为了简单，`createModel` 实际返回一个无需 `new` 即可调用的函数。
 * 为弥合公开类型与内部实现之间的差异，这里定义一个继承公开接口、
 * 同时允许不带 `new` 调用的内部接口，让模型的实例化写起来更简单。
 *
 * @internal
 */
interface InternalModelConstructor<
	TModel,
	TFactoryArgs extends unknown[],
> extends ModelConstructor<TModel, TFactoryArgs> {
	(...args: TFactoryArgs): Model<TModel>;
}

function startCapturingEffects(): () => Effect[] | undefined {
	let prevCapturedEffects = capturedEffects;
	// 即使 `untracked()` 已临时清空外层捕获作用域，这里也总是建立全新的捕获作用域：
	// 让嵌套模型持有自己的 effect，而不会被提升进被屏蔽的外层作用域
	capturedEffects = [];

	return function stopCapturingEffects() {
		const modelEffects = capturedEffects;
		if (capturedEffects && prevCapturedEffects) {
			prevCapturedEffects = prevCapturedEffects.concat(capturedEffects);
		}

		capturedEffects = prevCapturedEffects;

		return modelEffects;
	};
}

const wrapInAction = (value: Record<string, unknown>): void => {
	for (const key in value) {
		const val = value[key];
		if (typeof val === "function") {
			value[key] = action(val as (...args: unknown[]) => unknown);
		} else if (typeof val === "object" && val !== null && !("brand" in val)) {
			// 递归把嵌套对象的属性也包装为 action：
			// 用户编写嵌套模型时无需再手动给函数包 `action`
			wrapInAction(val as Record<string, unknown>);
		}
	}
};

function createModel<TModel, TFactoryArgs extends unknown[] = []>(
	modelFactory: ModelFactory<TModel, TFactoryArgs>
): ModelConstructor<TModel, TFactoryArgs> {
	return function SignalModel(...args: TFactoryArgs): Model<TModel> {
		let modelEffects: Effect[] | undefined;
		let model: Model<TModel>;

		const stopCapturingEffects = startCapturingEffects();
		try {
			model = modelFactory(...args) as Model<TModel>;
		} catch (err) {
			// 出错时丢弃所有已捕获的 effect：嵌套模型的错误会冒泡到这里，
			// 递归地把 `capturedEffects` 重置为 `undefined`，防止捕获的 effect 泄漏
			capturedEffects = undefined;
			throw err;
		} finally {
			modelEffects = stopCapturingEffects();
		}

		wrapInAction(model);

		model[Symbol.dispose] = action(function disposeModel() {
			if (modelEffects) {
				for (let i = 0; i < modelEffects.length; i++) {
					modelEffects[i].dispose();
				}
			}

			modelEffects = undefined;
		});

		return model;
	} as InternalModelConstructor<TModel, TFactoryArgs>;
}

//#endregion 模型 createModel

// 值导出：可运行时调用的工厂函数与构造器
export {
	computed,
	effect,
	batch,
	untracked,
	action,
	createModel,
	Signal,
  type ReadonlySignal,
	Effect,
	Computed,
};
