"use client";

export { default as ImageStudio } from './components/ImageStudio';
export { default as VideoStudio } from './components/VideoStudio';
export { default as LipSyncStudio } from './components/LipSyncStudio';
export { default as CinemaStudio } from './components/CinemaStudio';
export { default as AudioStudio } from './components/AudioStudio';
export { default as AppsStudio } from './components/AppsStudio';
export { default as McpCliStudio } from './components/McpCliStudio';
// MuAPI-only surfaces removed from the fal build — their components import
// uninitialized submodules (design-agent / workflow-builder / ai-agent) and
// call reject-stubbed clients: ClippingStudio, VibeMotionStudio, MarketingStudio,
// WorkflowStudio, AgentStudio, DesignAgentStudio.
export * from './muapi';
