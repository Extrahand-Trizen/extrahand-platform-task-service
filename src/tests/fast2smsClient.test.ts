import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { type AxiosAdapter } from 'axios';
import { Fast2SMSClient } from '../clients/Fast2SMSClient';

test('Fast2SMS returns the provider message ID on successful delivery', async () => {
  const previousAdapter = axios.defaults.adapter;
  const adapter: AxiosAdapter = async (config) => ({
    data: { return: true, status_code: 200, request_id: 'request-123' },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  });
  Fast2SMSClient.initialize('unit-test-token');
  axios.defaults.adapter = adapter;

  try {
    const result = await Fast2SMSClient.sendTaskStartOTP('9876543210', '1234', 'Test task');
    assert.deepEqual(result, { status: 'sent', messageId: 'request-123' });
  } finally {
    axios.defaults.adapter = previousAdapter;
  }
});

test('Fast2SMS reports an explicit provider rejection without retrying as success', async () => {
  const previousAdapter = axios.defaults.adapter;
  const adapter: AxiosAdapter = async (config) => ({
    data: { return: false, status_code: 400 },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  });
  Fast2SMSClient.initialize('unit-test-token');
  axios.defaults.adapter = adapter;

  try {
    const result = await Fast2SMSClient.sendTaskStartOTP('9876543210', '1234', 'Test task');
    assert.equal(result.status, 'failed');
  } finally {
    axios.defaults.adapter = previousAdapter;
  }
});

test('Fast2SMS marks a transport timeout as unknown to prevent duplicate SMS retries', async () => {
  const previousAdapter = axios.defaults.adapter;
  const adapter: AxiosAdapter = async () => {
    const error = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    throw error;
  };
  Fast2SMSClient.initialize('unit-test-token');
  axios.defaults.adapter = adapter;

  try {
    const result = await Fast2SMSClient.sendTaskStartOTP('9876543210', '1234', 'Test task');
    assert.equal(result.status, 'unknown');
  } finally {
    axios.defaults.adapter = previousAdapter;
  }
});
