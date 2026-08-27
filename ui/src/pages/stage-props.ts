/** Shared prop shape every guided-tour stage component accepts. */
export interface StageProps {
  /** Advances to the next stage; undefined on the final stage. */
  onNext?: () => void
}
