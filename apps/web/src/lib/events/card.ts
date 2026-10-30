// What an event card reads: the event, its city and styles, and the school it belongs to (name and logo).
export const cardInclude = {city: true, styles: {include: {style: true}}, school: {select: {name: true, avatarKey: true, hiddenAt: true}}} as const;
