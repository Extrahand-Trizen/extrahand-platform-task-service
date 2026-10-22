import assert from 'assert';
import axios from 'axios';
import { NotificationClient } from '../services/NotificationClient';

async function runTests() {
  const originalPost = axios.post;
  const payload = {
    eventKey: 'TASK_UPDATED',
    category: 'taskUpdates' as const,
    recipients: ['partner-uid'],
    entity: { type: 'task' as const, id: '665f1c2e9b1e8a0012345678' },
    title: 'New Book Now work offer',
    body: 'Accept or reject this offer.',
    data: { taskId: '665f1c2e9b1e8a0012345678', action: 'book_now_offer' },
  };

  try {
    axios.post = (async () =>
      ({
        data: {
          success: true,
          data: { sent: 1, failed: 0, deliveredUserIds: ['partner-uid'] },
        },
      }) as any) as typeof axios.post;
    assert.deepStrictEqual(
      await NotificationClient.sendWithDeliveryResults(payload),
      ['partner-uid'],
    );

    axios.post = (async () =>
      ({
        data: {
          success: true,
          data: { sent: 1, failed: 1, deliveredUserIds: ['partner-uid'] },
        },
      }) as any) as typeof axios.post;
    assert.deepStrictEqual(
      await NotificationClient.sendWithDeliveryResults({
        ...payload,
        recipients: ['partner-uid', 'partner-without-device'],
      }),
      ['partner-uid'],
    );

    axios.post = (async () =>
      ({
        data: {
          success: false,
          data: { sent: 0, failed: 0, deliveredUserIds: [] },
        },
      }) as any) as typeof axios.post;
    assert.deepStrictEqual(await NotificationClient.sendWithDeliveryResults(payload), []);

    axios.post = (async () =>
      ({
        data: {
          success: true,
          data: { sent: 0, failed: 1, deliveredUserIds: [] },
        },
      }) as any) as typeof axios.post;
    assert.deepStrictEqual(await NotificationClient.sendWithDeliveryResults(payload), []);

    console.log('bookNowOfferNotificationDelivery.test.ts: all tests passed');
  } finally {
    axios.post = originalPost;
  }
}

void runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
