/**
 * Drive calendar (AD-06): student-level clash detection across drives, company-email parsing into a
 * proposed schedule, and clash-free slot allocation. The database also enforces room, panel and student
 * exclusivity; this module finds conflicts before anything is written and explains them.
 */

export interface CalendarEvent { id: string; driveId: string; title: string; startsAt: string; endsAt: string; roomId?: string | null }

export interface Clash { kind: 'room' | 'student'; a: string; b: string; message: string; studentCount?: number }

const overlaps = (a: CalendarEvent, b: CalendarEvent) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);

/**
 * Room clashes between any two events, and student clashes between rounds of different drives that share
 * candidates (studentsByDrive: drive → eligible or applied student ids).
 */
export function detectClashes(events: CalendarEvent[], studentsByDrive: Map<string, Set<string>>): Clash[] {
  const out: Clash[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i], b = events[j];
      if (!overlaps(a, b)) continue;
      if (a.roomId && a.roomId === b.roomId) {
        out.push({ kind: 'room', a: a.id, b: b.id, message: `${a.title} and ${b.title} are booked in the same room at the same time.` });
      }
      if (a.driveId !== b.driveId) {
        const sa = studentsByDrive.get(a.driveId), sb = studentsByDrive.get(b.driveId);
        if (sa && sb) {
          let n = 0;
          for (const s of sa) if (sb.has(s)) n++;
          if (n > 0) out.push({ kind: 'student', a: a.id, b: b.id, studentCount: n, message: `${n} student(s) are candidates for both ${a.title} and ${b.title}, which overlap.` });
        }
      }
    }
  }
  return out;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export interface ParsedWindow { label: string; kind: string; start: string; end: string }
export interface ParsedCompanyEmail { date: string | null; windows: ParsedWindow[]; unparsed: string[] }

function kindFor(label: string): string {
  const l = label.toLowerCase();
  if (/(ppt|pre[- ]placement|presentation)/.test(l)) return 'pre_placement_talk';
  if (/aptitude/.test(l)) return 'aptitude';
  if (/(coding|technical test|online test|machine)/.test(l)) return 'technical_test';
  if (/(group discussion|\bgd\b)/.test(l)) return 'group_discussion';
  if (/\bhr\b/.test(l)) return 'hr';
  if (/interview/.test(l)) return 'interview';
  return 'interview';
}

function to24(h: number, m: number, ampm?: string): string {
  let hh = h;
  if (ampm) {
    const p = ampm.toLowerCase();
    if (p.startsWith('p') && hh < 12) hh += 12;
    if (p.startsWith('a') && hh === 12) hh = 0;
  }
  return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Parses a company's visit email into a date and labelled time windows, e.g.
 * "We'd like to visit on 9 December 2026. Aptitude test 10:00–11:00, technical interviews 11:30 am to 5 pm."
 * Times are interpreted in the college's timezone offset (default IST, +05:30). Anything it cannot parse
 * is returned in `unparsed` for the officer, never guessed.
 */
export function parseCompanyEmail(text: string, tzOffset = '+05:30'): ParsedCompanyEmail {
  const dm = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s+(\d{4})\b/i);
  const date = dm ? `${dm[3]}-${String(MONTHS.indexOf(dm[2].toLowerCase()) + 1).padStart(2, '0')}-${String(Number(dm[1])).padStart(2, '0')}` : null;
  const windows: ParsedWindow[] = [];
  const unparsed: string[] = [];
  const clauses = text.split(/[.;\n]|,(?=\s*[A-Za-z])/).map(s => s.trim()).filter(Boolean);
  const timeRe = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:–|-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  for (const c of clauses) {
    const t = c.match(timeRe);
    if (!t) continue;
    const label = c.slice(0, t.index).replace(/\b(at|from|between|on)\s*$/i, '').trim() || 'Session';
    const endAmpm = t[6];
    const startAmpm = t[3] ?? (endAmpm && Number(t[1]) <= Number(t[4]) ? endAmpm : undefined);
    if (!date) { unparsed.push(c); continue; }
    windows.push({
      label, kind: kindFor(label),
      start: `${date}T${to24(Number(t[1]), Number(t[2] ?? 0), startAmpm)}:00${tzOffset}`,
      end: `${date}T${to24(Number(t[4]), Number(t[5] ?? 0), endAmpm)}:00${tzOffset}`,
    });
  }
  if (!date) unparsed.unshift('No visit date found (expected e.g. "9 December 2026").');
  return { date, windows: windows.filter(w => Date.parse(w.end) > Date.parse(w.start)), unparsed };
}

export interface RoomInfo { id: string; name: string; capacity: number }
export interface Booking { roomId: string; startsAt: string; endsAt: string }
export interface Allocation { label: string; kind: string; start: string; end: string; roomId: string | null; roomName: string | null; note: string }

/**
 * Assigns each window the smallest free room that fits the expected head-count; windows with no free
 * room are returned with roomId null and a note, for the officer to resolve.
 */
export function allocateRooms(windows: ParsedWindow[], rooms: RoomInfo[], bookings: Booking[], headCount: number): Allocation[] {
  const taken = [...bookings];
  return windows.map(w => {
    const free = rooms
      .filter(r => r.capacity >= headCount)
      .sort((a, b) => a.capacity - b.capacity)
      .find(r => !taken.some(b => b.roomId === r.id && Date.parse(w.start) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(w.end)));
    if (free) taken.push({ roomId: free.id, startsAt: w.start, endsAt: w.end });
    return {
      label: w.label, kind: w.kind, start: w.start, end: w.end,
      roomId: free?.id ?? null, roomName: free?.name ?? null,
      note: free ? `${free.name} (capacity ${free.capacity}) is free.` : `No free room for ${headCount} people; choose a time or split the batch.`,
    };
  });
}
