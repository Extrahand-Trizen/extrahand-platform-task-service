/**
 * Unit tests for Book Now assignment notifications (customer push / in-app / WhatsApp, partner unchanged).
 * Run: npx ts-node src/tests/bookNowAssignmentNotify.test.ts
 */
import assert from 'assert';
import { NotificationClient } from '../services/NotificationClient';
import { InAppNotificationClient } from '../clients/InAppNotificationClient';
import * as dialogUserModule from '../clients/fireDialogWhatsAppForUser';
import { notifyBookNowAssignment } from '../services/AssignmentService';

type Captured = { push: any[]; inApp: any[]; whatsapp: any[] };

function installStubs(): Captured {
  const captured: Captured = { push: [], inApp: [], whatsapp: [] };
  (NotificationClient as any).send = async (payload: any) => {
    captured.push.push(payload);
  };
  (InAppNotificationClient as any).send = async (payload: any) => {
    captured.inApp.push(payload);
  };
  (dialogUserModule as any).fireDialogWhatsAppForUser = (input: any) => {
    captured.whatsapp.push(input);
  };
  return captured;
}

const BASE = {
  actorUid: 'ops-uid',
  taskId: '665f1c2e9b1e8a0012345678',
  taskTitle: 'Deep home cleaning',
  customerUid: 'customer-uid',
  helperUid: 'partner-uid',
  helperName: 'Ravi Kumar',
  helperRating: 4.8,
};

async function testBookNowCustomerChannels() {
  const captured = installStubs();
  await notifyBookNowAssignment({ ...BASE, recipientRole: 'partner' });

  const customerPush = captured.push.filter((p) => p.recipients.includes(BASE.customerUid));
  assert.strictEqual(customerPush.length, 1);
  assert.strictEqual(customerPush[0].eventKey, 'TASK_UPDATED');
  assert.strictEqual(customerPush[0].data.recipientRole, 'customer');
  assert.strictEqual(customerPush[0].data.taskTitle, BASE.taskTitle);
  assert.ok(!captured.push.some((p) => p.eventKey === 'BOOK_NOW_PARTNER_ASSIGNED'));

  const customerInApp = captured.inApp.filter((n) => n.userId === BASE.customerUid);
  assert.strictEqual(customerInApp.length, 1);
  assert.strictEqual(customerInApp[0].data.recipientRole, 'customer');
  assert.strictEqual(customerInApp[0].data.eventKey, 'TASK_UPDATED');

  assert.strictEqual(captured.whatsapp.length, 1);
  const wa = captured.whatsapp[0];
  assert.strictEqual(wa.uid, BASE.customerUid);
  assert.strictEqual(wa.eventKey, 'PARTNER_ASSIGNED_CUSTOMER');
  assert.strictEqual(wa.payload.partnerName, BASE.helperName);
  assert.strictEqual(wa.payload.taskTitle, BASE.taskTitle);
  assert.strictEqual(wa.payload.taskId, BASE.taskId);
  assert.match(
    wa.idempotencyKey,
    new RegExp(`^eh-push:${BASE.customerUid}:PARTNER_ASSIGNED_CUSTOMER:${BASE.taskId}:\\d+$`),
  );
}

async function testPartnerNotificationsUnchanged() {
  const captured = installStubs();
  await notifyBookNowAssignment({ ...BASE, recipientRole: 'partner' });

  const partnerPush = captured.push.filter((p) => p.recipients.includes(BASE.helperUid));
  assert.strictEqual(partnerPush.length, 1);
  assert.strictEqual(partnerPush[0].eventKey, 'TASK_UPDATED');
  assert.strictEqual(partnerPush[0].data.recipientRole, 'partner');
  assert.ok(!captured.whatsapp.some((w) => w.uid === BASE.helperUid));
}

async function testMarketplaceAssignmentHasNoCustomerWhatsApp() {
  const captured = installStubs();
  await notifyBookNowAssignment({ ...BASE, recipientRole: 'tasker' });

  assert.strictEqual(captured.whatsapp.length, 0);
  const customerPush = captured.push.filter((p) => p.recipients.includes(BASE.customerUid));
  assert.strictEqual(customerPush.length, 1);
  assert.strictEqual(customerPush[0].eventKey, 'TASK_UPDATED');
}

async function testNoCustomerNotificationsWhenDisabled() {
  const captured = installStubs();
  await notifyBookNowAssignment({ ...BASE, recipientRole: 'partner', notifyCustomer: false });

  assert.ok(!captured.push.some((p) => p.recipients.includes(BASE.customerUid)));
  assert.ok(!captured.inApp.some((n) => n.userId === BASE.customerUid));
  assert.strictEqual(captured.whatsapp.length, 0);
}

(async () => {
  await testBookNowCustomerChannels();
  await testPartnerNotificationsUnchanged();
  await testMarketplaceAssignmentHasNoCustomerWhatsApp();
  await testNoCustomerNotificationsWhenDisabled();
  console.log('bookNowAssignmentNotify.test.ts: all tests passed');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
