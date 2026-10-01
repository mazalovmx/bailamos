# Swing community model

Swing and Lindy Hop are the primary audience. This determines catalogue ordering, homepage content and examples.

## Design references

- Herräng separates Lindy Hop, Solo Jazz, Balboa, levels and prerequisites. Since level labels can differ across schools, classes include explicit prerequisites. [Herräng courses](https://www.herrang.com/2026/courses).
- Swing Patrol offers weekly classes where partnered dancing does not necessarily require bringing a partner. Dance format and partner requirements are separate fields. [Swing Patrol classes](https://www.swingpatrol.co.uk/about-classes/).
- SwingStep distinguishes courses from topics such as swing-outs, solo technique, musicality, conditioning and routines. Topics belong in tags rather than new styles. [SwingStep classes](https://swingstep.com/classes/).

## Product decisions

1. **Style/substyle:** Swing includes Lindy Hop, Solo Jazz, Balboa, Shag, Charleston and Boogie Woogie, with additional branches in the catalogue. Charleston has solo/partnered variants; Balboa has Pure Balboa and Bal-Swing. This is navigation, not a definitive historical taxonomy.
2. **Event type:** class, workshop, masterclass, intensive, practice, social or festival. The organizer chooses between workshop and masterclass; no universal distinction is imposed.
3. **Format:** solo, partnered or mixed. Solo events cannot require a partner.
4. **Level:** open, newcomer, beginner, improver, intermediate, advanced or professional. Level is not inferred from music tempo.
5. **Physical intensity:** relaxed, moderate or energetic. An organizer's description, not a medical assessment.
6. **Music tempo:** slow, medium, fast or varied. No universal BPM thresholds are imposed.
7. **Tags:** musicality, improvisation, footwork, connection, technique, solo routines, swing-outs, live music, switch roles, beginner-friendly and taster classes.
8. **Schedule:** occurrences are materialized as dates, preserving local wall-clock time across DST. The original weekly series supported 2–52 sessions; expanded recurrence/exception support is covered by the event tests.
9. **Unknown values:** legacy events do not receive invented levels or intensity; unspecified remains explicit.
10. **Attendance:** series RSVP and per-occurrence reservations are distinct. UI wording must match the endpoint. Per-date exceptions, capacity and waiting lists must not be implied without implementation.

## Discovery examples

- Solo Jazz + solo + beginner + relaxed intensity + slow music + musicality.
- Lindy Hop + partnered + workshop + intermediate + fast music.
- Swing + regular classes + no partner required.
- A parent style includes its descendants through the catalogue-aware search.

Multi-select filters use OR within a group and AND across groups. Event/profile forms keep singular fields where the domain value is singular, such as an event's city. Public examples are never automatically published by seeding.
