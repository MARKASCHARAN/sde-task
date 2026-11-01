import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'
import '../styles.css'
import type { Balance, Bill, Home, Member } from '../types'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

const AVATAR_COLORS = ['coral', 'violet', 'mint']

function getMemberColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length] ?? 'violet'
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? 'ME').toUpperCase()
  const first = parts[0]?.[0] ?? ''
  const second = parts[1]?.[0] ?? ''
  return (first + second).toUpperCase()
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function Dashboard() {
  const [homes, setHomes] = useState<Home[]>([])
  const [activeHomeId, setActiveHomeId] = useState<string>('')
  const [members, setMembers] = useState<Member[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  const [selectedMemberId, setSelectedMemberId] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // In-flight states
  const [payingShareId, setPayingShareId] = useState<string | null>(null)
  const [isCreatingBill, setIsCreatingBill] = useState<boolean>(false)
  const [isAddingMember, setIsAddingMember] = useState<boolean>(false)
  const [isCreatingHome, setIsCreatingHome] = useState<boolean>(false)

  // Modals
  const [showAddBillModal, setShowAddBillModal] = useState<boolean>(false)
  const [showAddMemberModal, setShowAddMemberModal] = useState<boolean>(false)
  const [showAddHomeModal, setShowAddHomeModal] = useState<boolean>(false)

  // Form values
  const [billTitle, setBillTitle] = useState<string>('')
  const [billAmountInput, setBillAmountInput] = useState<string>('')
  const [newMemberName, setNewMemberName] = useState<string>('')
  const [newHomeName, setNewHomeName] = useState<string>('')

  // Map of shareId -> idempotencyKey to reuse on retry
  const idempotencyKeys = useRef<Record<string, string>>({})

  // Load homes on initial mount
  const loadHomes = useCallback(async () => {
    try {
      setIsLoading(true)
      const fetchedHomes = await api.getHomes()
      setHomes(fetchedHomes)
      if (fetchedHomes.length > 0 && !activeHomeId) {
        const firstHome = fetchedHomes[0]
        if (firstHome) {
          setActiveHomeId(firstHome.id)
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load homes')
    } finally {
      setIsLoading(false)
    }
  }, [activeHomeId])

  useEffect(() => {
    loadHomes()
  }, [loadHomes])

  // Load home data (members, bills, balances)
  const loadHomeData = useCallback(async (homeId: string) => {
    if (!homeId) return
    try {
      setIsLoading(true)
      const [fetchedMembers, fetchedBills, fetchedBalances] = await Promise.all([
        api.getMembers(homeId),
        api.getBills(homeId),
        api.getBalances(homeId),
      ])
      setMembers(fetchedMembers)
      setBills(fetchedBills)
      setBalances(fetchedBalances)

      if (fetchedMembers.length > 0) {
        setSelectedMemberId((prev) => {
          const exists = fetchedMembers.some((m) => m.id === prev)
          return exists ? prev : (fetchedMembers[0]?.id ?? '')
        })
      } else {
        setSelectedMemberId('')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load home data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeHomeId) {
      loadHomeData(activeHomeId)
    }
  }, [activeHomeId, loadHomeData])

  // Current viewing member
  const currentMember = useMemo(
    () => members.find((m) => m.id === selectedMemberId) ?? members[0],
    [members, selectedMemberId],
  )

  // Current member's outstanding balance
  const currentMemberBalance = useMemo(() => {
    if (!currentMember) return 0
    const b = balances.find((item) => item.memberId === currentMember.id)
    return b?.outstandingCents ?? 0
  }, [balances, currentMember])

  // Shares stats
  const totalSharesCount = useMemo(
    () => bills.reduce((acc, b) => acc + b.shares.length, 0),
    [bills],
  )
  const paidSharesCount = useMemo(
    () => bills.reduce((acc, b) => acc + b.shares.filter((s) => s.paidAt !== null).length, 0),
    [bills],
  )

  // Uneven bill split calculation preview
  const parsedCents = Math.round(Number.parseFloat(billAmountInput || '0') * 100)
  const isPositiveIntegerCents = Number.isInteger(parsedCents) && parsedCents > 0
  const splitPreview =
    isPositiveIntegerCents && members.length > 0
      ? members.map((member, index) => {
          const base = Math.floor(parsedCents / members.length)
          const remainder = parsedCents % members.length
          const shareAmount = base + (index < remainder ? 1 : 0)
          return {
            memberId: member.id,
            memberName: member.name,
            shareAmount,
          }
        })
      : null

  // Handler: Pay Share with Idempotency Key Reuse
  const handlePayShare = async (billId: string, shareId: string) => {
    if (payingShareId) return

    if (!idempotencyKeys.current[shareId]) {
      idempotencyKeys.current[shareId] = crypto.randomUUID()
    }
    const key = idempotencyKeys.current[shareId]

    try {
      setPayingShareId(shareId)
      setError(null)
      const paidShare = await api.payShare(billId, shareId, key)

      delete idempotencyKeys.current[shareId]

      setBills((prevBills) =>
        prevBills.map((b) => {
          if (b.id !== billId) return b
          return {
            ...b,
            shares: b.shares.map((s) =>
              s.id === shareId ? { ...s, paidAt: paidShare.paidAt } : s,
            ),
          }
        }),
      )

      if (activeHomeId) {
        const freshBalances = await api.getBalances(activeHomeId)
        setBalances(freshBalances)
      }
      setSuccessMessage('Payment processed successfully!')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payment failed'
      setError(`${msg} (You can safely retry with the same key)`)
    } finally {
      setPayingShareId(null)
    }
  }

  // Handler: Create Bill
  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeHomeId || !billTitle.trim() || !isPositiveIntegerCents) {
      setError('Please provide a valid title and positive amount.')
      return
    }

    if (members.length === 0) {
      setError('Cannot split a bill without members. Add a member first.')
      return
    }

    try {
      setIsCreatingBill(true)
      setError(null)
      await api.createBill(activeHomeId, billTitle.trim(), parsedCents)
      setBillTitle('')
      setBillAmountInput('')
      setShowAddBillModal(false)
      await loadHomeData(activeHomeId)
      setSuccessMessage('Bill created and split successfully!')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create bill')
    } finally {
      setIsCreatingBill(false)
    }
  }

  // Handler: Add Member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeHomeId || !newMemberName.trim()) return

    try {
      setIsAddingMember(true)
      setError(null)
      const newMember = await api.addMember(activeHomeId, newMemberName.trim())
      setMembers((prev) => [...prev, newMember])
      setNewMemberName('')
      setShowAddMemberModal(false)
      const freshBalances = await api.getBalances(activeHomeId)
      setBalances(freshBalances)
      setSuccessMessage(`Member "${newMember.name}" added to household!`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setIsAddingMember(false)
    }
  }

  // Handler: Create Home
  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newHomeName.trim()) return

    try {
      setIsCreatingHome(true)
      setError(null)
      const created = await api.createHome(newHomeName.trim())
      setHomes((prev) => [created, ...prev])
      setActiveHomeId(created.id)
      setNewHomeName('')
      setShowAddHomeModal(false)
      setSuccessMessage(`Home "${created.name}" created!`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create home')
    } finally {
      setIsCreatingHome(false)
    }
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      {/* Topbar */}
      <nav className="topbar">
        <a className="brand" href="/" aria-label="Nest home">
          <span className="brand-mark">N</span>
          <span>Nest</span>
        </a>

        <div className="topbar-actions">
          {homes.length > 0 && (
            <select
              className="home-select"
              value={activeHomeId}
              onChange={(e) => setActiveHomeId(e.target.value)}
              aria-label="Select home"
            >
              {homes.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          )}

          <button type="button" className="btn-ghost" onClick={() => setShowAddHomeModal(true)}>
            + Home
          </button>

          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowAddMemberModal(true)}
            disabled={!activeHomeId}
          >
            + Member
          </button>

          <span className="sync-status">
            <span className="status-dot" />
            Synced
          </span>

          <button
            className="profile-button"
            type="button"
            aria-label="Open profile"
            title={currentMember ? currentMember.name : 'Profile'}
          >
            {currentMember ? getInitials(currentMember.name) : 'ME'}
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <section className="content">
        <header className="hero">
          <div>
            <p className="eyebrow">
              Good morning, {currentMember ? currentMember.name.split(' ')[0] : 'friend'}{' '}
              <span aria-hidden="true">✦</span>
            </p>
            <h1>
              Keep the household <em>in sync.</em>
            </h1>
            <p className="hero-copy">
              One calm place for shared expenses, balances, and everything in between.
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => setShowAddBillModal(true)}
            disabled={!activeHomeId || members.length === 0}
          >
            <span>＋</span> Add a bill
          </button>
        </header>

        {/* Summary Grid */}
        <section className="summary-grid" aria-label="Household summary">
          <article className="summary-card balance-card">
            <div className="card-icon">↗</div>
            <p>My outstanding</p>
            <strong>{formatCurrency(currentMemberBalance)}</strong>
            <span className="card-detail">Across {bills.length} bills</span>
          </article>

          <article className="summary-card">
            <div className="card-icon purple">◒</div>
            <p>Paid shares</p>
            <strong>
              {paidSharesCount}
              <small> / {totalSharesCount}</small>
            </strong>
            <span className="card-detail">Shares settled</span>
          </article>

          <article className="summary-card member-summary">
            <div className="card-icon yellow">⌂</div>
            <p>Your household</p>
            <div className="avatar-stack">
              {members.map((member, i) => (
                <span key={member.id} className={`avatar ${getMemberColor(i)}`} title={member.name}>
                  {getInitials(member.name)}
                </span>
              ))}
              <span className="member-count">
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </span>
            </div>
            <span className="card-detail">
              {homes.find((h) => h.id === activeHomeId)?.name || 'Home'}
            </span>
          </article>
        </section>

        {/* Section Heading & View Selector */}
        <div className="section-heading">
          <div>
            <h2>Recent bills</h2>
            <p>Everyone’s share, all in one view.</p>
          </div>
          {members.length > 0 && (
            <label className="member-select">
              <span className="sr-only">Viewing as</span>
              <select
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
              >
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    Viewing as {member.name.split(' ')[0]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* Error Notification */}
        {error && (
          <div className="error-banner" role="alert">
            <span>!</span>
            <div>
              <strong>Payment or request issue</strong>
              <p>{error}</p>
            </div>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}

        {/* Success Notification */}
        {successMessage && (
          <div className="success-banner" role="status">
            <span>✓</span>
            <div>
              <strong>Success</strong>
              <p>{successMessage}</p>
            </div>
            <button
              type="button"
              onClick={() => setSuccessMessage(null)}
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        )}

        {/* Bills List / State Cards */}
        {isLoading && bills.length === 0 ? (
          <div className="state-card">
            <div className="spinner" />
            <strong>Loading your household</strong>
            <p>Fetching the latest bills...</p>
          </div>
        ) : bills.length === 0 ? (
          <div className="state-card empty-state">
            <span className="empty-icon">✦</span>
            <strong>No bills yet</strong>
            <p>Add your first shared expense to get started.</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setShowAddBillModal(true)}
              disabled={!activeHomeId || members.length === 0}
            >
              Add your first bill
            </button>
          </div>
        ) : (
          <div className="bill-list">
            {bills.map((bill) => (
              <article className="bill-card" key={bill.id}>
                <div className="bill-heading">
                  <div className="bill-title-wrap">
                    <span className="bill-icon">
                      {bill.title.toLowerCase().includes('electric') ? '⌁' : '✣'}
                    </span>
                    <div>
                      <h3>{bill.title}</h3>
                      <p>
                        {bill.createdAt ? new Date(bill.createdAt).toLocaleDateString() : 'Recent'}{' '}
                        <span>·</span> {bill.shares.length} people
                      </p>
                    </div>
                  </div>
                  <strong className="bill-total">{formatCurrency(bill.totalCents)}</strong>
                </div>

                <div className="share-list">
                  {bill.shares.map((share) => {
                    const memberIndex = members.findIndex((m) => m.id === share.memberId)
                    const memberColor = getMemberColor(Math.max(memberIndex, 0))
                    const isCurrentMember = share.memberId === selectedMemberId
                    const isProcessing = payingShareId === share.id

                    return (
                      <div
                        className={`share-row ${isCurrentMember ? 'current-member' : ''}`}
                        key={share.id}
                      >
                        <span className={`avatar small ${memberColor}`}>
                          {getInitials(share.memberName || 'Member')}
                        </span>
                        <span className="share-name">
                          {share.memberName || 'Member'}{' '}
                          {isCurrentMember && <span className="you-tag">YOU</span>}
                        </span>
                        <span className="share-amount">{formatCurrency(share.amountCents)}</span>

                        {share.paidAt ? (
                          <span className="paid-label">
                            <span className="paid-check">✓</span> Paid
                          </span>
                        ) : (
                          <button
                            className={`pay-button ${isCurrentMember ? 'pay-button-active' : ''}`}
                            type="button"
                            onClick={() => handlePayShare(bill.id, share.id)}
                            disabled={payingShareId !== null}
                          >
                            {isProcessing ? 'Paying...' : 'Pay now'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="footer-note">
          <span className="tip-icon">⌘</span> Tip: payments are safely tracked with an idempotency
          key.
        </p>
      </section>

      {/* Modal: Add Bill */}
      {showAddBillModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h2 className="modal-title">Split New Expense</h2>
            <form onSubmit={handleCreateBill}>
              <div className="modal-field">
                <label htmlFor="modal-bill-title">Expense Title</label>
                <input
                  id="modal-bill-title"
                  type="text"
                  placeholder="e.g. WiFi, Groceries, Dinner"
                  value={billTitle}
                  onChange={(e) => setBillTitle(e.target.value)}
                  disabled={isCreatingBill}
                  required
                />
              </div>

              <div className="modal-field">
                <label htmlFor="modal-bill-amount">Total Amount ($)</label>
                <input
                  id="modal-bill-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="e.g. 30.00"
                  value={billAmountInput}
                  onChange={(e) => setBillAmountInput(e.target.value)}
                  disabled={isCreatingBill}
                  required
                />
              </div>

              {splitPreview && (
                <div className="split-preview-box">
                  <div className="split-preview-header">
                    Calculated Split ({members.length} members)
                  </div>
                  {splitPreview.map((item) => (
                    <div key={item.memberId} className="split-preview-row">
                      <span>{item.memberName}</span>
                      <strong>{formatCurrency(item.shareAmount)}</strong>
                    </div>
                  ))}
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setShowAddBillModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={isCreatingBill || !billTitle.trim() || !isPositiveIntegerCents}
                >
                  {isCreatingBill ? 'Splitting...' : 'Create & Split'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Member */}
      {showAddMemberModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h2 className="modal-title">Add Household Member</h2>
            <form onSubmit={handleAddMember}>
              <div className="modal-field">
                <label htmlFor="modal-member-name">Member Name</label>
                <input
                  id="modal-member-name"
                  type="text"
                  placeholder="e.g. Taylor, Jordan"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  disabled={isAddingMember}
                  required
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setShowAddMemberModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={isAddingMember || !newMemberName.trim()}
                >
                  {isAddingMember ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Home */}
      {showAddHomeModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h2 className="modal-title">Create New Home</h2>
            <form onSubmit={handleCreateHome}>
              <div className="modal-field">
                <label htmlFor="modal-home-name">Home Name</label>
                <input
                  id="modal-home-name"
                  type="text"
                  placeholder="e.g. Sunnyvale Apartment 4B"
                  value={newHomeName}
                  onChange={(e) => setNewHomeName(e.target.value)}
                  disabled={isCreatingHome}
                  required
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setShowAddHomeModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={isCreatingHome || !newHomeName.trim()}
                >
                  {isCreatingHome ? 'Creating...' : 'Create Home'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}
