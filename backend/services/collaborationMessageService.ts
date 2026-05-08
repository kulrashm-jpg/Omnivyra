import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';

export type MessageSource = 'activity' | 'calendar' | 'campaign';

export type MessageResponse = {
  id: string;
  message_text: string;
  created_by: string;
  created_at: string;
  parent_message_id: string | null;
};

type BaseMessageRow = MessageResponse & Record<string, unknown>;

type ListMessagesOptions = {
  table: string;
  select: string;
  source: MessageSource;
  userId?: string | null;
  applyFilters?: (query: any) => any;
};

type CreateMessageOptions = {
  table: string;
  select: string;
  insert: Record<string, unknown>;
};

type MessageCountsOptions = {
  table: string;
  select: string;
  groupField: string;
  groupValues: string[];
  source: MessageSource;
  userId?: string | null;
  applyFilters?: (query: any) => any;
};

function toResponse(row: BaseMessageRow): MessageResponse {
  return {
    id: String(row.id),
    message_text: String(row.message_text ?? ''),
    created_by: String(row.created_by ?? ''),
    created_at: String(row.created_at ?? ''),
    parent_message_id: typeof row.parent_message_id === 'string' ? row.parent_message_id : null,
  };
}

export async function markMessagesRead(
  messageIds: string[],
  source: MessageSource,
  userId?: string | null
): Promise<void> {
  if (!userId || messageIds.length === 0) {
    return;
  }

  const readAt = new Date().toISOString();
  const rows = messageIds.map((messageId) => ({
    message_id: messageId,
    message_source: source,
    user_id: userId,
    read_at: readAt,
  }));

  const { error } = await ownedDbTable('message_reads').upsert(rows, {
    onConflict: 'message_id,message_source,user_id',
    ignoreDuplicates: false,
  });

  if (error) {
    throw error;
  }
}

export async function listMessages(options: ListMessagesOptions): Promise<MessageResponse[]> {
  let query = ownedDbTable(options.table).select(options.select);
  if (options.applyFilters) {
    query = options.applyFilters(query);
  }

  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) {
    throw error;
  }

  const rows = (((data || []) as unknown) as BaseMessageRow[]).map(toResponse);
  await markMessagesRead(
    rows.map((row) => row.id),
    options.source,
    options.userId
  );

  return rows;
}

export async function createMessage(options: CreateMessageOptions): Promise<MessageResponse> {
  const { data, error } = await ownedDbTable(options.table)
    .insert(options.insert)
    .select(options.select)
    .single();

  if (error) {
    throw error;
  }

  return toResponse((data as unknown) as BaseMessageRow);
}

export async function getMessageCounts(options: MessageCountsOptions): Promise<Record<string, { total: number; unread: number }>> {
  const counts: Record<string, { total: number; unread: number }> = {};
  for (const value of options.groupValues) {
    counts[value] = { total: 0, unread: 0 };
  }

  if (options.groupValues.length === 0) {
    return counts;
  }

  let query = ownedDbTable(options.table).select(options.select);
  if (options.applyFilters) {
    query = options.applyFilters(query);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rows = ((data || []) as unknown) as Array<{ id: string } & Record<string, unknown>>;
  const messageIds = rows.map((row) => String(row.id));
  const readMessageIds = new Set<string>();

  if (options.userId && messageIds.length > 0) {
    const { data: readRows, error: readError } = await ownedDbTable('message_reads')
      .select('message_id')
      .eq('message_source', options.source)
      .eq('user_id', options.userId)
      .in('message_id', messageIds);

    if (readError) {
      throw readError;
    }

    for (const row of readRows || []) {
      readMessageIds.add(String(row.message_id));
    }
  }

  for (const row of rows) {
    const groupValue = String(row[options.groupField] ?? '');
    if (!counts[groupValue]) {
      continue;
    }
    counts[groupValue].total += 1;
    if (!readMessageIds.has(String(row.id))) {
      counts[groupValue].unread += 1;
    }
  }

  return counts;
}
