import type { Balance, Bill, Home, Member, Share } from './types'

export class ApiError extends Error {
  public status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Network error'
    throw new ApiError(`Unable to reach server: ${errorMsg}`, 0)
  }

  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // Non-JSON response
  }

  if (!response.ok) {
    const errorObj = data as { error?: string } | null
    const message = errorObj?.error || `Request failed with status ${response.status}`
    throw new ApiError(message, response.status)
  }

  return data as T
}

export async function getHomes(): Promise<Home[]> {
  const data = await request<{ homes: Home[] }>('/api/homes')
  return data.homes
}

export async function createHome(name: string): Promise<Home> {
  return request<Home>('/api/homes', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function getMembers(homeId: string): Promise<Member[]> {
  const data = await request<{ members: Member[] }>(`/api/homes/${homeId}/members`)
  return data.members
}

export async function addMember(homeId: string, name: string): Promise<Member> {
  return request<Member>(`/api/homes/${homeId}/members`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function getBills(homeId: string): Promise<Bill[]> {
  const data = await request<{ bills: Bill[] }>(`/api/homes/${homeId}/bills`)
  return data.bills
}

export async function createBill(homeId: string, title: string, totalCents: number): Promise<Bill> {
  return request<Bill>(`/api/homes/${homeId}/bills`, {
    method: 'POST',
    body: JSON.stringify({ title, totalCents }),
  })
}

export async function payShare(
  billId: string,
  shareId: string,
  idempotencyKey: string,
): Promise<Share> {
  return request<Share>(`/api/bills/${billId}/shares/${shareId}/pay`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
  })
}

export async function getBalances(homeId: string): Promise<Balance[]> {
  const data = await request<{ balances: Balance[] }>(`/api/homes/${homeId}/balances`)
  return data.balances
}
