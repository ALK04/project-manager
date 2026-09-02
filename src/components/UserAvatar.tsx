import { UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Member } from '@/hooks/useProfiles'

const SIZES = {
  xs: 'h-4 w-4 text-[8px]',
  sm: 'h-5 w-5 text-[9px]',
  md: 'h-7 w-7 text-[11px]',
} as const

interface UserAvatarProps {
  member?: Member
  size?: keyof typeof SIZES
  className?: string
}

function initials(name: string): string {
  const parts = name.split(/[\s-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function UserAvatar({ member, size = 'sm', className }: UserAvatarProps) {
  if (!member) {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground shrink-0',
          SIZES[size],
          className
        )}
        title="Non assignée"
      >
        <UserRound className="h-2.5 w-2.5" />
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0 leading-none',
        SIZES[size],
        className
      )}
      style={{ backgroundColor: member.color }}
      title={member.displayName}
    >
      {initials(member.displayName)}
    </span>
  )
}
