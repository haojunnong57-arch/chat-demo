import { create } from 'zustand'
import type { SessionSummary } from '../../services/chat/types.js'

type SessionInstructionsState = {
  session: SessionSummary | null
  open: (session: SessionSummary) => void
  close: () => void
}

export const useSessionInstructions = create<SessionInstructionsState>((set) => ({
  session: null,
  open: (session) => set({ session }),
  close: () => set({ session: null }),
}))

export const openSessionInstructions = (session: SessionSummary) =>
  useSessionInstructions.getState().open(session)

export const closeSessionInstructions = () => useSessionInstructions.getState().close()
