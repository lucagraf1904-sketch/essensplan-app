// Supabase-Zugang. Beide Werte sind für den Browser gedacht und dürfen öffentlich sein.
// Leer lassen = App läuft nur lokal auf diesem Gerät.
export const SUPABASE_URL = 'https://ixynvpdkgzukqrqzdtwo.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_WudPbBqhAU-WS1lB0JuQqQ_uCfn77PK'; // Publishable key (öffentlich, Luca 23.11.)

// Öffentlicher VAPID-Schlüssel für Push-Nachrichten (siehe README „Push-Erinnerungen“).
// Leer = Erinnerungen nur, solange die App offen ist bzw. beim Öffnen.
export const VAPID_PUBLIC_KEY = 'BKPA0uZjhhZuaNxsFzjBaCtPtK6wBJZKizhpI5JmZAWcdvkmf7is8E1fHfZtpeTmwtLHrPeWvf_OeUU4ugL0In4'; // öffentlicher Schlüssel, darf sichtbar sein (23.11.)

// Bewegung aus Apple Health per iPhone-Kurzbefehl (siehe KURZBEFEHL.md). VORBEREITET, noch nicht live:
// erst auf true setzen, wenn Supabase läuft und der Essensplaner fertig ist.
export const HEALTH_ENABLED = false;
// Name des Kurzbefehls auf dem iPhone, exakt wie in der Kurzbefehle-App (Knopf „Schritte aktualisieren“ startet ihn)
export const HEALTH_SHORTCUT_NAME = 'Speisekammer Bewegung';
