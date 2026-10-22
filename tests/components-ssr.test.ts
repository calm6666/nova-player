// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { h, renderToString } from '../core';
import { Loading } from '../packages/player/src/components/Loading';
import { State } from '../packages/player/src/components/State';
import { Switch } from '../packages/player/src/components/Switch';
import { Slider } from '../packages/player/src/components/Slider';
import { Selection } from '../packages/player/src/components/Selection';
import { VolumeHint } from '../packages/player/src/components/VolumeHint';
import { Tooltips } from '../packages/player/src/components/Tooltips';
import { Toast } from '../packages/player/src/components/Toast';
import { Dialog } from '../packages/player/src/components/Dialog';
import { Context } from '../packages/player/src/components/Context';
import { Mini } from '../packages/player/src/components/Mini';
import { ProgressBar } from '../packages/player/src/components/ProgressBar';
import { HotkeyPanel } from '../packages/player/src/components/HotkeyPanel';
import { ColorPanel } from '../packages/player/src/components/ColorPanel';
import { AudioPanel } from '../packages/player/src/components/AudioPanel';
import { VideoInfo } from '../packages/player/src/components/VideoInfo';
import { EpisodesMenu } from '../packages/player/src/components/EpisodesMenu';
import { QualityMenu } from '../packages/player/src/components/QualityMenu';
import { SubtitleMenu } from '../packages/player/src/components/SubtitleMenu';
import { SettingMenu } from '../packages/player/src/components/SettingMenu';
import { PlaybackRateMenu } from '../packages/player/src/components/PlaybackRateMenu';
import { ViewpointMenu } from '../packages/player/src/components/ViewpointMenu';
import { SendBar } from '../packages/player/src/components/SendBar';
import { DmSetting } from '../packages/player/src/components/DmSetting';

const components = [
  Loading,
  State,
  Switch,
  Slider,
  Selection,
  VolumeHint,
  Tooltips,
  Toast,
  Dialog,
  Context,
  Mini,
  ProgressBar,
  HotkeyPanel,
  ColorPanel,
  AudioPanel,
  VideoInfo,
  EpisodesMenu,
  QualityMenu,
  SubtitleMenu,
  SettingMenu,
  PlaybackRateMenu,
  ViewpointMenu,
  SendBar,
  DmSetting,
] as const;

describe('component SSR guards', () => {
  it.each(components.map((component) => [component.name, component]))(
    'renders %s without browser globals',
    (_name, component) => {
      expect(() =>
        renderToString(h(component as never, {} as never)),
      ).not.toThrow();
    },
  );
});
