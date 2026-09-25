"use client";

import { createContext, useContext } from "react";

/**
 * Lets <PhotoPicker /> hand videos picked on the New Stage form to
 * <NewStageForm />. Videos can't ride the form post like photos do —
 * they blow past the request-body limit and need the direct-to-storage
 * upload, which needs a stage id. So the form holds them until the
 * stage exists, then uploads them and navigates.
 */
export type PendingVideosApi = {
  videos: File[];
  setVideos: (update: (prev: File[]) => File[]) => void;
  maxBytes: number;
};

export const PendingVideosContext = createContext<PendingVideosApi | null>(null);

export function usePendingVideos(): PendingVideosApi | null {
  return useContext(PendingVideosContext);
}
