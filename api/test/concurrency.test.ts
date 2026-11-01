import { describe, expect, it } from 'vitest'
import { call, createBill, createHome, type Share } from './helpers'

function pay(billId: string, shareId: string, key?: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: key ? { 'Idempotency-Key': key } : {},
  })
}

describe('payment concurrency and edge cases', () => {
  it('handles two simultaneous payments with different keys: exactly one succeeds and one returns 409', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const firstShare = bill.body.shares[0]
    if (!firstShare) throw new Error('share missing')

    const keyA = `key-A-${crypto.randomUUID()}`
    const keyB = `key-B-${crypto.randomUUID()}`

    // Fire two requests concurrently
    const [resA, resB] = await Promise.all([
      pay(bill.body.id, firstShare.id, keyA),
      pay(bill.body.id, firstShare.id, keyB),
    ])

    const statuses = [resA?.status, resB?.status].sort()
    // Exactly one 200 and one 409
    expect(statuses).toEqual([200, 409])

    const successRes = resA?.status === 200 ? resA : resB
    const conflictRes = resA?.status === 409 ? resA : resB

    expect(successRes?.body.id).toBe(firstShare.id)
    expect(successRes?.body.paidAt).toEqual(expect.any(String))
    expect(conflictRes?.status).toBe(409)
  })

  it('handles two simultaneous payments with the same key: both succeed with same result', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const firstShare = bill.body.shares[0]
    if (!firstShare) throw new Error('share missing')

    const key = `key-concurrent-${crypto.randomUUID()}`

    // Fire two identical requests concurrently
    const [res1, res2] = await Promise.all([
      pay(bill.body.id, firstShare.id, key),
      pay(bill.body.id, firstShare.id, key),
    ])

    expect(res1?.status).toBe(200)
    expect(res2?.status).toBe(200)
    expect(res1?.body.paidAt).toBe(res2?.body.paidAt)
  })

  it('rejects reusing an idempotency key across different shares with 409', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share1 = bill.body.shares[0]
    const share2 = bill.body.shares[1]
    if (!share1 || !share2) throw new Error('shares missing')

    const key = `shared-key-${crypto.randomUUID()}`

    const res1 = await pay(bill.body.id, share1.id, key)
    expect(res1.status).toBe(200)

    const res2 = await pay(bill.body.id, share2.id, key)
    expect(res2.status).toBe(409)
  })

  it('returns zero outstanding balance for members with no unpaid shares', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const shareA = bill.body.shares[0]
    const shareB = bill.body.shares[1]
    if (!shareA || !shareB) throw new Error('shares missing')

    await pay(bill.body.id, shareA.id, crypto.randomUUID())
    await pay(bill.body.id, shareB.id, crypto.randomUUID())

    const balanceRes = await call<{
      balances: Array<{ memberId: string; name: string; outstandingCents: number }>
    }>('GET', `/api/homes/${homeId}/balances`)

    expect(balanceRes.status).toBe(200)
    expect(balanceRes.body.balances).toEqual([
      { memberId: members[0]?.id, name: 'Asha', outstandingCents: 0 },
      { memberId: members[1]?.id, name: 'Ben', outstandingCents: 0 },
    ])
  })
})
