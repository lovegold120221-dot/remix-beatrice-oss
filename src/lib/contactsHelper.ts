export interface GoogleContact {
  id: string;
  resourceName?: string;
  name: string;
  givenName?: string;
  familyName?: string;
  email: string;
  phone?: string;
  organization?: string;
  title?: string;
  avatarUrl?: string;
  notes?: string;
  birthday?: string;
  address?: string;
  starred?: boolean;
}

/**
 * Fetch contacts from Google People API or backend proxy
 */
export async function listGoogleContacts(
  accessToken?: string,
  query: string = ''
): Promise<{ contacts: GoogleContact[]; totalCount: number; error?: string }> {
  try {
    if (accessToken) {
      // Direct call to Google People API connections endpoint
      const url = query.trim()
        ? `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(
            query
          )}&readMask=names,emailAddresses,phoneNumbers,organizations,photos,addresses,birthdays,biographies`
        : `https://people.googleapis.com/v1/people/me/connections?pageSize=100&personFields=names,emailAddresses,phoneNumbers,organizations,photos,addresses,birthdays,biographies`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.ok) {
        const data = await res.json();
        const rawConnections = query.trim()
          ? (data.results || []).map((r: any) => r.person)
          : data.connections || [];

        if (Array.isArray(rawConnections)) {
          const parsedContacts: GoogleContact[] = rawConnections.map(
            (person: any, idx: number) => {
              const nameObj = person.names?.[0] || {};
              const name = nameObj.displayName || 'Unnamed Contact';
              const emailObj = person.emailAddresses?.[0] || {};
              const email = emailObj.value || 'No email provided';
              const phoneObj = person.phoneNumbers?.[0] || {};
              const phone = phoneObj.value || '';
              const orgObj = person.organizations?.[0] || {};
              const organization = orgObj.name || '';
              const title = orgObj.title || '';
              const photoObj = person.photos?.[0] || {};
              const avatarUrl = photoObj.url || '';
              const bioObj = person.biographies?.[0] || {};
              const notes = bioObj.value || '';
              const addrObj = person.addresses?.[0] || {};
              const address = addrObj.formattedValue || '';

              return {
                id: person.resourceName || `contact_${idx}`,
                resourceName: person.resourceName,
                name,
                givenName: nameObj.givenName,
                familyName: nameObj.familyName,
                email,
                phone,
                organization,
                title,
                avatarUrl,
                notes,
                address,
              };
            }
          );

          return {
            contacts: parsedContacts,
            totalCount: data.totalItems || parsedContacts.length,
          };
        }
      }
    }

    // Try backend fallback
    const backendRes = await fetch(
      `/api/workspace/contacts?q=${encodeURIComponent(query)}`
    );
    if (backendRes.ok) {
      const data = await backendRes.json();
      if (data.contacts) {
        return {
          contacts: data.contacts,
          totalCount: data.count || data.contacts.length,
        };
      }
      if (data.error) {
        console.warn('Backend contacts error:', data.error);
        return { contacts: [], totalCount: 0, error: data.error };
      }
    }
  } catch (err) {
    console.error('Error fetching Google Contacts:', err);
    return { contacts: [], totalCount: 0 };
  }

  // No mock data — return empty results when API unavailable or no query
  return { contacts: [], totalCount: 0 };
}

/**
 * Helper to create a new contact via Google People API or backend fallback
 */
export async function createGoogleContact(
  contact: Omit<GoogleContact, 'id'>,
  accessToken?: string
): Promise<{ success: boolean; contact?: GoogleContact; error?: string }> {
  try {
    if (accessToken) {
      const res = await fetch(
        `https://people.googleapis.com/v1/people:createContact?personFields=names,emailAddresses,phoneNumbers,organizations,biographies`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            names: [{ givenName: contact.givenName || contact.name, familyName: contact.familyName || '' }],
            emailAddresses: [{ value: contact.email }],
            phoneNumbers: contact.phone ? [{ value: contact.phone }] : [],
            organizations: contact.organization ? [{ name: contact.organization, title: contact.title || '' }] : [],
            biographies: contact.notes ? [{ value: contact.notes }] : [],
          }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const created: GoogleContact = {
          id: data.resourceName || `contact_${Date.now()}`,
          resourceName: data.resourceName,
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          organization: contact.organization,
          title: contact.title,
          notes: contact.notes,
        };
        return { success: true, contact: created };
      }
    }

    // Fallback — no mock IDs; return failure so caller can surface "create failed"
    return { success: false, error: 'Contact creation failed without access token' };
  } catch (err: any) {
    console.error('Error creating Google contact:', err);
    return { success: false, error: err.message };
  }
}