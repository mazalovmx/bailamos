import {auth, confirmedEmailChange} from '../auth';
import {sendMail, mailLocale, siteUrl, type MailLocale} from '../mail';
const notice: Record<MailLocale, {subject: string; body: (email: string) => string}> = {
  en: {subject: 'Request to change your email', body: email => 'Someone signed in to your account asked to change its email address to ' + email
    + '. The address changes only after the link sent to the new address is opened; that link expires in 1 hour.\n\n'
    + 'If this was you, there is nothing to do here. If it was not, change your password and sign out of all other devices in your account settings:'},
  es: {subject: 'Solicitud de cambio de correo', body: email => 'Alguien con la sesión iniciada en tu cuenta ha pedido cambiar su correo a ' + email
    + '. La dirección solo cambia cuando se abre el enlace enviado a la nueva dirección; ese enlace caduca en 1 hora.\n\n'
    + 'Si has sido tú, no tienes que hacer nada. Si no, cambia tu contraseña y cierra la sesión en los demás dispositivos desde los ajustes de tu cuenta:'},
  ru: {subject: 'Запрос на смену почты', body: email => 'Кто-то, вошедший в ваш аккаунт, запросил смену адреса почты на ' + email
    + '. Адрес изменится только после перехода по ссылке, отправленной на новый адрес; ссылка действует 1 час.\n\n'
    + 'Если это были вы, ничего делать не нужно. Если нет — смените пароль и выйдите на всех остальных устройствах в настройках аккаунта:'}
};
/**
 * Starts an email change for the signed-in user behind `headers`: Better Auth mails a confirmation link to the NEW address,
 * and the current address gets a notice. Nothing changes until the link is opened. The caller has already confirmed the
 * identity of the user. An address that belongs to another account gets no mail and the same answer, so the form reveals nothing.
 */
export async function requestEmailChange(headers: Headers, user: {email: string; locale?: string | null}, newEmail: string) {
  const locale = mailLocale(user.locale), settings = siteUrl() + '/' + locale + '/settings';
  await confirmedEmailChange.run(true, () => auth.api.changeEmail({headers, body: {newEmail, callbackURL: settings + '?emailChanged=1'}}));
  await sendMail(user.email, notice[locale].subject, notice[locale].body(newEmail) + '\n\n' + settings);
}
