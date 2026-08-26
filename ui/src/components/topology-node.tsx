import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface TopologyNodeProps {
  icon: LucideIcon
  title: string
  subtitle: string
  badge: string
  delay?: number
  className?: string
}

export function TopologyNode({
  icon: Icon,
  title,
  subtitle,
  badge,
  delay = 0,
  className,
}: TopologyNodeProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
    >
      <Card className={cn('w-56 gap-3 text-center', className)}>
        <CardHeader className="flex flex-col items-center gap-2">
          <div className="bg-accent/10 text-accent flex size-10 items-center justify-center rounded-full">
            <Icon className="size-5" />
          </div>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2">
          <p className="text-muted-foreground text-sm">{subtitle}</p>
          <Badge variant="secondary">{badge}</Badge>
        </CardContent>
      </Card>
    </motion.div>
  )
}
