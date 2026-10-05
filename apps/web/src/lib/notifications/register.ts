import {registerDelivery} from '../notify';
import {sendPush} from './push';
import {registerTelegramDelivery} from '../telegram/delivery';
// Import this module once in every server process that calls notify() (web server and background worker).
// The flag survives hot reloads, so the push channel is never registered twice.
const state = globalThis as {__dancePushDelivery?: boolean};
if (!state.__dancePushDelivery) {
  state.__dancePushDelivery = true;
  registerDelivery(async (userId, type, data, url) => {const result=await sendPush(userId, type, data, url);if(result.failed)throw new Error('PUSH_DELIVERY_FAILED');});
}
registerTelegramDelivery();
export const notificationDeliveriesRegistered = true;
