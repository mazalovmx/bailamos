export const adminOrigin = () => new URL(process.env.ADMIN_URL || 'http://localhost:3001').origin;
// Public address of the web app: used only to build preview and "open on site" links.
export const webOrigin = () => new URL(process.env.WEB_URL || process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
export const mediaUrl = (key: string) => webOrigin() + '/api/media/file/' + key.split('/').map(encodeURIComponent).join('/');
