export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet: string;
  subject: string;
  from: string;
  to?: string;
  date: string;
  body?: string;
  unread?: boolean;
}

export interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
  cc?: string;
}

/**
 * Helper to list messages from Gmail via REST API or backend proxy
 */
export async function listGmailMessages(
  accessToken?: string,
  query: string = 'in:inbox'
): Promise<{ messages: GmailMessage[]; totalCount: number; error?: string }> {
  try {
    if (accessToken) {
      // Try direct Google REST API fetch
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(
          query
        )}&maxResults=10`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.messages && Array.isArray(data.messages)) {
          // Fetch details for top 5 messages
          const details = await Promise.all(
            data.messages.slice(0, 8).map(async (m: { id: string }) => {
              return fetchMessageDetails(m.id, accessToken);
            })
          );
          return {
            messages: details.filter((d): d is GmailMessage => d !== null),
            totalCount: data.resultSizeEstimate || data.messages.length,
          };
        }
      }
    }

    // Fallback to server endpoint
    const backendRes = await fetch(
      `/api/workspace/gmail/messages?q=${encodeURIComponent(query)}`
    );
    if (backendRes.ok) {
      const data = await backendRes.json();
      if (data?.error) {
        return { messages: [], totalCount: 0, error: data.error };
      }
      return {
        messages: data.messages || [],
        totalCount: data.totalCount || 0,
      };
    }
  } catch (err) {
    console.error('Error in listGmailMessages:', err);
  }

  // NO mock fallback — if both the direct API and the server endpoint are
  // unavailable, surface the failure instead of fabricating inbox contents.
  return {
    messages: [],
    totalCount: 0,
    error:
      'Gmail is not available right now — the Google connection could not be reached. Please reconnect Google from the profile menu and try again.',
  };
}

/**
 * Helper to fetch a single message detail
 */
export async function fetchMessageDetails(
  messageId: string,
  accessToken?: string
): Promise<GmailMessage | null> {
  if (accessToken) {
    try {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        const headers = data.payload?.headers || [];
        const subject =
          headers.find((h: any) => h.name.toLowerCase() === 'subject')
            ?.value || '(No Subject)';
        const from =
          headers.find((h: any) => h.name.toLowerCase() === 'from')?.value ||
          'Unknown';
        const to =
          headers.find((h: any) => h.name.toLowerCase() === 'to')?.value || '';
        const dateHeader = headers.find(
          (h: any) => h.name.toLowerCase() === 'date'
        )?.value;
        const date = dateHeader
          ? new Date(dateHeader).toLocaleString()
          : new Date(parseInt(data.internalDate || '0')).toLocaleString();

        let body = data.snippet || '';
        if (data.payload?.body?.data) {
          body = atob(
            data.payload.body.data.replace(/-/g, '+').replace(/_/g, '/')
          );
        } else if (data.payload?.parts?.[0]?.body?.data) {
          body = atob(
            data.payload.parts[0].body.data
              .replace(/-/g, '+')
              .replace(/_/g, '/')
          );
        }

        return {
          id: data.id,
          threadId: data.threadId,
          labelIds: data.labelIds,
          snippet: data.snippet || '',
          subject,
          from,
          to,
          date,
          body,
          unread: data.labelIds?.includes('UNREAD'),
        };
      }
    } catch (e) {
      console.error('Error fetching message detail from Google:', e);
    }
  }

  return null;
}

/**
 * Helper to send email via Gmail API or Server API
 */
export async function sendGmailMessage(
  payload: SendEmailPayload,
  accessToken?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    if (accessToken) {
      // Build RFC 2822 formatted email in base64url
      const emailLines = [
        `To: ${payload.to}`,
        `Subject: ${payload.subject}`,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        payload.body,
      ];
      if (payload.cc) emailLines.unshift(`Cc: ${payload.cc}`);

      const rawEmail = btoa(emailLines.join('\r\n'))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw: rawEmail }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        return { success: true, messageId: data.id };
      }
    }

    // Server fallback
    const res = await fetch('/api/workspace/gmail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      return { success: true, messageId: data.messageId };
    }
  } catch (err: any) {
    console.error('Error sending email:', err);
    return { success: false, error: err.message };
  }

  // NO mock fallback — never report an email as sent when it wasn't. Surface
  // the failure so the user can reconnect Google or retry.
  return {
    success: false,
    error:
      'Email could not be sent — the Google connection is unavailable or the send request failed. Please reconnect Google from the profile menu and try again.',
  };
}
