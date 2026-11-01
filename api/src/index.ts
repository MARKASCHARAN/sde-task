import { Hono } from 'hono'

type Bindings = Env

type ErrorResponse = {
  error: string
}

type CreateHomeBody = {
  name?: unknown
}

type CreateMemberBody = {
  name?: unknown
}

type CreateBillBody = {
  title?: unknown
  totalCents?: unknown
}

type ShareResponse = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

type CreateBillResponse = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: ShareResponse[]
}

type MemberRow = {
  id: string
  home_id: string
  name: string
  member_order: number
}

type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
}

type PaymentRow = {
  id: string
  share_id: string
  idempotency_key: string
  paid_at: string
}

type PayShareResponse = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string
}

type BalanceItem = {
  memberId: string
  name: string
  outstandingCents: number
}

type BalancesResponse = {
  balances: BalanceItem[]
}

const app = new Hono<{ Bindings: Bindings }>()

app.onError((err, c) => {
  return c.json<ErrorResponse>({ error: err.message || 'Internal Server Error' }, 500)
})

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// GET /api/homes - List homes for frontend
app.get('/api/homes', async (c) => {
  const { results: homes } = await c.env.DB.prepare(
    'SELECT id, name, created_at AS createdAt FROM homes ORDER BY created_at DESC',
  ).all<{ id: string; name: string; createdAt: string }>()

  return c.json({ homes: homes ?? [] }, 200)
})

// GET /api/homes/:homeId - Get single home details
app.get('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare(
    'SELECT id, name, created_at AS createdAt FROM homes WHERE id = ?',
  )
    .bind(homeId)
    .first<{ id: string; name: string; createdAt: string }>()

  if (!home) {
    return c.json<ErrorResponse>({ error: 'Home not found' }, 404)
  }

  return c.json(home, 200)
})

// GET /api/homes/:homeId/members - List members of a home
app.get('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json<ErrorResponse>({ error: 'Home not found' }, 404)
  }

  const { results: members } = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, name, member_order AS memberOrder FROM members WHERE home_id = ? ORDER BY member_order ASC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; name: string; memberOrder: number }>()

  return c.json({ members: members ?? [] }, 200)
})

// GET /api/homes/:homeId/bills - List bills and their shares with member names
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json<ErrorResponse>({ error: 'Home not found' }, 404)
  }

  type BillDbRow = {
    id: string
    home_id: string
    title: string
    total_cents: number
    created_at: string
  }

  const { results: bills } = await c.env.DB.prepare(
    'SELECT id, home_id, title, total_cents, created_at FROM bills WHERE home_id = ? ORDER BY created_at DESC',
  )
    .bind(homeId)
    .all<BillDbRow>()

  type ShareWithMemberDbRow = {
    id: string
    bill_id: string
    member_id: string
    member_name: string
    amount_cents: number
    paid_at: string | null
  }

  const { results: allShares } = await c.env.DB.prepare(
    `SELECT
      s.id, s.bill_id, s.member_id, m.name AS member_name, s.amount_cents, s.paid_at
    FROM bill_shares s
    JOIN members m ON m.id = s.member_id
    JOIN bills b ON b.id = s.bill_id
    WHERE b.home_id = ?
    ORDER BY m.member_order ASC`,
  )
    .bind(homeId)
    .all<ShareWithMemberDbRow>()

  type FrontendShare = {
    id: string
    memberId: string
    memberName: string
    amountCents: number
    paidAt: string | null
  }

  const sharesByBill = new Map<string, FrontendShare[]>()
  for (const s of allShares ?? []) {
    const list = sharesByBill.get(s.bill_id) ?? []
    list.push({
      id: s.id,
      memberId: s.member_id,
      memberName: s.member_name,
      amountCents: s.amount_cents,
      paidAt: s.paid_at,
    })
    sharesByBill.set(s.bill_id, list)
  }

  const formattedBills = (bills ?? []).map((bill) => ({
    id: bill.id,
    homeId: bill.home_id,
    title: bill.title,
    totalCents: bill.total_cents,
    createdAt: bill.created_at,
    shares: sharesByBill.get(bill.id) ?? [],
  }))

  return c.json({ bills: formattedBills }, 200)
})

// POST /api/homes - Create a home
app.post('/api/homes', async (c) => {
  let body: CreateHomeBody
  try {
    body = await c.req.json<CreateHomeBody>()
  } catch {
    return c.json<ErrorResponse>({ error: 'Invalid JSON payload' }, 400)
  }

  if (typeof body?.name !== 'string' || body.name.trim().length === 0) {
    return c.json<ErrorResponse>({ error: 'Name is required' }, 400)
  }

  const name = body.name.trim()
  const id = crypto.randomUUID()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

// POST /api/homes/:homeId/members - Add a member to a home
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  // Check if home exists
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json<ErrorResponse>({ error: 'Home not found' }, 404)
  }

  let body: CreateMemberBody
  try {
    body = await c.req.json<CreateMemberBody>()
  } catch {
    return c.json<ErrorResponse>({ error: 'Invalid JSON payload' }, 400)
  }

  if (typeof body?.name !== 'string' || body.name.trim().length === 0) {
    return c.json<ErrorResponse>({ error: 'Member name is required' }, 400)
  }

  const name = body.name.trim()
  const id = crypto.randomUUID()

  // Calculate next member_order deterministically for this home
  const orderRow = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(member_order), 0) + 1 AS next_order FROM members WHERE home_id = ?',
  )
    .bind(homeId)
    .first<{ next_order: number }>()

  const memberOrder = orderRow?.next_order ?? 1

  await c.env.DB.prepare(
    'INSERT INTO members (id, home_id, name, member_order) VALUES (?, ?, ?, ?)',
  )
    .bind(id, homeId, name, memberOrder)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// POST /api/homes/:homeId/bills - Create a bill and split among home members
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  // Check if home exists
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json<ErrorResponse>({ error: 'Home not found' }, 404)
  }

  let body: CreateBillBody
  try {
    body = await c.req.json<CreateBillBody>()
  } catch {
    return c.json<ErrorResponse>({ error: 'Invalid JSON payload' }, 400)
  }

  // Validate totalCents: must be a positive whole number
  if (
    typeof body?.totalCents !== 'number' ||
    !Number.isInteger(body.totalCents) ||
    body.totalCents <= 0
  ) {
    return c.json<ErrorResponse>({ error: 'totalCents must be a positive whole number' }, 422)
  }

  // Validate title
  if (typeof body?.title !== 'string' || body.title.trim().length === 0) {
    return c.json<ErrorResponse>({ error: 'Title is required' }, 400)
  }

  const title = body.title.trim()
  const totalCents = body.totalCents

  // Retrieve members ordered by member_order ASC
  const { results: members } = await c.env.DB.prepare(
    'SELECT id, home_id, name, member_order FROM members WHERE home_id = ? ORDER BY member_order ASC',
  )
    .bind(homeId)
    .all<MemberRow>()

  if (!members || members.length === 0) {
    return c.json<ErrorResponse>({ error: 'Home has no members' }, 422)
  }

  // Calculate shares using integer arithmetic
  const base = Math.floor(totalCents / members.length)
  const remainder = totalCents % members.length

  const billId = crypto.randomUUID()
  const statements: D1PreparedStatement[] = []

  // 1. Insert bill
  statements.push(
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents),
  )

  // 2. Insert shares
  const shares: ShareResponse[] = []
  for (const [i, member] of members.entries()) {
    const shareId = crypto.randomUUID()
    const amountCents = base + (i < remainder ? 1 : 0)

    statements.push(
      c.env.DB.prepare(
        'INSERT INTO bill_shares (id, bill_id, member_id, amount_cents, paid_at) VALUES (?, ?, ?, ?, NULL)',
      ).bind(shareId, billId, member.id, amountCents),
    )

    shares.push({
      id: shareId,
      memberId: member.id,
      amountCents,
      paidAt: null,
    })
  }

  // Execute atomically via D1 batch transaction
  await c.env.DB.batch(statements)

  return c.json<CreateBillResponse>(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares,
    },
    201,
  )
})

// POST /api/bills/:billId/shares/:shareId/pay - Pay a share with idempotency & concurrency safety
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim()
  if (!idempotencyKey) {
    return c.json<ErrorResponse>({ error: 'Idempotency-Key header is required' }, 400)
  }

  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  // 1. Verify bill exists
  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()
  if (!bill) {
    return c.json<ErrorResponse>({ error: 'Bill not found' }, 404)
  }

  // 2. Verify share exists and belongs to this bill
  const share = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at FROM bill_shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()

  if (!share) {
    return c.json<ErrorResponse>({ error: 'Share not found' }, 404)
  }

  // 3. Check if idempotency key was already used
  const existingKeyPayment = await c.env.DB.prepare(
    'SELECT id, share_id, idempotency_key, paid_at FROM payments WHERE idempotency_key = ?',
  )
    .bind(idempotencyKey)
    .first<PaymentRow>()

  if (existingKeyPayment) {
    if (existingKeyPayment.share_id === shareId) {
      // Same key, same share -> return 200 with original result
      return c.json<PayShareResponse>(
        {
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt: existingKeyPayment.paid_at,
        },
        200,
      )
    }
    // Same key, different share -> return 409
    return c.json<ErrorResponse>(
      { error: 'Idempotency key already used for a different share' },
      409,
    )
  }

  // 4. Check if share is already paid with a different key
  if (share.paid_at !== null) {
    return c.json<ErrorResponse>({ error: 'Share has already been paid' }, 409)
  }

  // 5. Execute atomic conditional update and payment record insertion
  const now = new Date().toISOString()
  const paymentId = crypto.randomUUID()

  try {
    const results = await c.env.DB.batch([
      c.env.DB.prepare('UPDATE bill_shares SET paid_at = ? WHERE id = ? AND paid_at IS NULL').bind(
        now,
        shareId,
      ),
      c.env.DB.prepare(
        `INSERT INTO payments (id, share_id, idempotency_key, paid_at)
         SELECT ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM bill_shares WHERE id = ? AND paid_at = ?)`,
      ).bind(paymentId, shareId, idempotencyKey, now, shareId, now),
    ])

    const updateResult = results[0]
    const insertResult = results[1]
    if (
      !updateResult ||
      updateResult.meta.changes === 0 ||
      !insertResult ||
      insertResult.meta.changes === 0
    ) {
      return c.json<ErrorResponse>({ error: 'Share has already been paid' }, 409)
    }

    return c.json<PayShareResponse>(
      {
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: now,
      },
      200,
    )
  } catch (_err) {
    // Concurrent request conflict caught by UNIQUE constraint on share_id or idempotency_key
    const paymentAfterRace = await c.env.DB.prepare(
      'SELECT id, share_id, idempotency_key, paid_at FROM payments WHERE idempotency_key = ? OR share_id = ?',
    )
      .bind(idempotencyKey, shareId)
      .first<PaymentRow>()

    if (paymentAfterRace) {
      if (
        paymentAfterRace.idempotency_key === idempotencyKey &&
        paymentAfterRace.share_id === shareId
      ) {
        return c.json<PayShareResponse>(
          {
            id: share.id,
            memberId: share.member_id,
            amountCents: share.amount_cents,
            paidAt: paymentAfterRace.paid_at,
          },
          200,
        )
      }
    }

    return c.json<ErrorResponse>({ error: 'Share has already been paid' }, 409)
  }
})

// GET /api/homes/:homeId/balances - Calculate outstanding balances for home members
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  // 1. Verify home exists
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json<ErrorResponse>({ error: 'Home not found' }, 404)
  }

  // 2. Query outstanding unpaid shares across all bills in this home, ordered by member_order
  const { results: balances } = await c.env.DB.prepare(
    `SELECT
      m.id AS memberId,
      m.name AS name,
      CAST(COALESCE(
        (
          SELECT SUM(s.amount_cents)
          FROM bill_shares s
          JOIN bills b ON b.id = s.bill_id
          WHERE s.member_id = m.id
            AND b.home_id = m.home_id
            AND s.paid_at IS NULL
        ),
        0
      ) AS INTEGER) AS outstandingCents
    FROM members m
    WHERE m.home_id = ?
    ORDER BY m.member_order ASC`,
  )
    .bind(homeId)
    .all<BalanceItem>()

  return c.json<BalancesResponse>({ balances: balances ?? [] }, 200)
})

export default app
