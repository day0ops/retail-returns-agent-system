import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface TourProgressProps {
  /** Zero-indexed position of the current stage. */
  current: number
  total: number
}

/** Segmented progress bar shown above every guided-tour stage. */
export function TourProgress({ current, total }: TourProgressProps) {
  return (
    <div className="mx-auto flex w-full max-w-5xl items-center gap-1.5 px-6 pt-6">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="bg-muted h-1 flex-1 overflow-hidden rounded-full">
          {i <= current && (
            <motion.div
              className={cn(
                'h-full rounded-full',
                i === current ? 'bg-accent-foreground' : 'bg-foreground',
              )}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.3 }}
              style={{ transformOrigin: 'left' }}
            />
          )}
        </div>
      ))}
    </div>
  )
}
