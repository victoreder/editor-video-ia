import React from 'react';
import {Composition, type CalculateMetadataFunction} from 'remotion';
import {Reel, type ReelProps} from './Reel';
import {planDurationFrames} from '../lib/plan/timeline';
import {emptyDemoPlan} from './demo';
import {Cover, type CoverProps} from './Cover';

const calc: CalculateMetadataFunction<ReelProps> = async ({props}) => ({
  fps: props.plan.format.fps,
  width: props.plan.format.width,
  height: props.plan.format.height,
  durationInFrames: Math.max(1, planDurationFrames(props.plan)),
});

const calcCover: CalculateMetadataFunction<CoverProps> = async ({props}) => ({
  fps: props.plan.format.fps,
  width: props.plan.format.width,
  height: props.plan.format.height,
  durationInFrames: 1,
});

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Reel" component={Reel} durationInFrames={300} fps={30} width={1080} height={1920} defaultProps={{plan: emptyDemoPlan(), media: {}}} calculateMetadata={calc} />
    <Composition id="Cover" component={Cover} durationInFrames={1} fps={30} width={1080} height={1920} defaultProps={{plan: emptyDemoPlan(), media: {}, t: 0, title: 'TÍTULO|DA CAPA'}} calculateMetadata={calcCover} />
  </>
);
