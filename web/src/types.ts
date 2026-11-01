export type Home = {
  id: string
  name: string
  createdAt?: string
}

export type Member = {
  id: string
  homeId: string
  name: string
  memberOrder?: number
}

export type Share = {
  id: string
  memberId: string
  memberName?: string
  amountCents: number
  paidAt: string | null
}

export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  createdAt?: string
  shares: Share[]
}

export type Balance = {
  memberId: string
  name: string
  outstandingCents: number
}

export type ActionStatus = 'idle' | 'loading' | 'success' | 'error'
