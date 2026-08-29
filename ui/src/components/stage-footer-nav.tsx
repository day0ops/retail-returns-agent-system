import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface StageFooterNavProps {
  onBack?: () => void
  onNext?: () => void
  /** Defaults to a plain "Next" -- some stages want a more descriptive label. */
  nextLabel?: string
}

/**
 * Shared Back/Next footer for every guided-tour stage, replacing what used
 * to be a copy of the same "Next" button hand-rolled in all seven pages.
 * Renders nothing if neither direction is available (shouldn't happen in
 * practice -- every stage has at least one neighbor).
 */
export function StageFooterNav({ onBack, onNext, nextLabel = 'Next' }: StageFooterNavProps) {
  if (!onBack && !onNext) return null

  return (
    <div className="flex w-full items-center justify-between">
      {onBack ? (
        <Button onClick={onBack} variant="ghost">
          <ArrowLeft className="size-3.5" /> Back
        </Button>
      ) : (
        <span />
      )}
      {onNext && (
        <Button onClick={onNext} variant="secondary">
          {nextLabel} <ArrowRight className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
