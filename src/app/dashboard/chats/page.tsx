import { db } from '@/db'
import { chatConversations, chatMessages, tracks, visitors } from '@/db/schema'
import { eq, desc, inArray, asc } from 'drizzle-orm'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'
import { ChatInbox, type InboxConversation } from './ChatInbox'

export default async function ChatsPage() {
  const { dbUser } = await getDashboardAuthContext()
  const orgId = dbUser.organizationId

  // Tracks owned by this org
  const orgTracks = await db
    .select({ id: tracks.id, title: tracks.title })
    .from(tracks)
    .where(eq(tracks.organizationId, orgId))

  const trackTitleById = new Map(orgTracks.map((t) => [t.id, t.title]))
  const orgTrackIds = orgTracks.map((t) => t.id)

  if (orgTrackIds.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Chats</h1>
        <p className="text-muted-foreground">No tracks yet — chat conversations will appear here once visitors use the assistant.</p>
      </div>
    )
  }

  const conversations = await db
    .select({
      id: chatConversations.id,
      trackId: chatConversations.trackId,
      contactEmail: chatConversations.contactEmail,
      contactName: chatConversations.contactName,
      visitorEmail: visitors.capturedEmail,
      messageCount: chatConversations.messageCount,
      lastMessageAt: chatConversations.lastMessageAt,
      createdAt: chatConversations.createdAt,
    })
    .from(chatConversations)
    .leftJoin(visitors, eq(chatConversations.visitorId, visitors.id))
    .where(inArray(chatConversations.trackId, orgTrackIds))
    .orderBy(desc(chatConversations.lastMessageAt))
    .limit(500)

  const conversationIds = conversations.map((c) => c.id)

  const messages = conversationIds.length
    ? await db
        .select({
          conversationId: chatMessages.conversationId,
          role: chatMessages.role,
          content: chatMessages.content,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(inArray(chatMessages.conversationId, conversationIds))
        .orderBy(asc(chatMessages.createdAt))
    : []

  const messagesByConversation = new Map<string, { role: string; content: string; createdAt: string }[]>()
  for (const m of messages) {
    const list = messagesByConversation.get(m.conversationId) ?? []
    list.push({ role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })
    messagesByConversation.set(m.conversationId, list)
  }

  const inbox: InboxConversation[] = conversations.map((c) => ({
    id: c.id,
    trackTitle: trackTitleById.get(c.trackId) ?? 'Unknown track',
    contact: c.contactName || c.contactEmail || c.visitorEmail || null,
    messageCount: c.messageCount,
    lastMessageAt: c.lastMessageAt.toISOString(),
    messages: messagesByConversation.get(c.id) ?? [],
  }))

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Chats</h1>
        <p className="text-muted-foreground mt-2">
          AI assistant conversations from your public tracks. Captured contacts are linked when a visitor submits a form.
        </p>
      </div>
      <ChatInbox conversations={inbox} />
    </div>
  )
}
