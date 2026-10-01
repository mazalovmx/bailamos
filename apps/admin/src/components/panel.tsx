'use client';
import {createContext, useContext} from 'react';
import type {ResourceMeta} from '../lib/resources';
export type PanelUser = {id: string; name: string; email: string; role: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'SCHOOL_ADMIN'};
export type Panel = {user: PanelUser; meta: ResourceMeta[]; webUrl: string};
export type Row = Record<string, unknown> & {id: string; _labels?: Record<string, string>};
export const PanelContext = createContext<Panel | null>(null);
export function usePanel() {
  const panel = useContext(PanelContext);
  if (!panel) throw new Error('Panel context is missing');
  return panel;
}
export function useResourceMeta(name: string) {
  const found = usePanel().meta.find(item => item.name === name);
  if (!found) throw new Error('Unknown resource');
  return found;
}
// Reported object type → the resource that lists it.
export const targetResources: Record<string, string> = {EVENT: 'events', PROFILE: 'profiles', POST: 'posts', MEDIA: 'media', MESSAGE: 'messages', VENUE: 'venues'};
