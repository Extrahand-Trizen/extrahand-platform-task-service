import axios, { AxiosError } from 'axios';
import logger from '../config/logger';
import { validateEnv } from '../config/env';

/**
 * Payment Client for Task Service
 * Handles communication with payment service for escrow operations
 */
export class PaymentClient {
  private static baseURL: string;
  private static serviceAuthToken: string;

  static initialize() {
    const env = validateEnv();
    this.baseURL = env.PAYMENT_SERVICE_URL || 'http://localhost:4003';
    this.serviceAuthToken = env.SERVICE_AUTH_TOKEN || '';
  }

  /**
   * Get escrow by task ID
   */
  static async getEscrowByTaskId(taskId: string): Promise<any | null> {
    try {
      if (!this.baseURL || !this.serviceAuthToken) {
        this.initialize();
      }

      const response = await axios.get(
        `${this.baseURL}/api/v1/escrow/task/${taskId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
          },
          timeout: 10000
        }
      );

      if (response.data.success && response.data.escrow) {
        return response.data.escrow;
      }

      return null;
    } catch (error) {
      // Don't throw error - escrow lookup is non-critical for task completion
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 404) {
          // No escrow found - this is okay, task might not have escrow
          logger.info('No escrow found for task', { taskId });
          return null;
        }
        logger.error('Failed to get escrow by task ID', {
          taskId,
          status: axiosError.response?.status,
          message: axiosError.message
        });
      } else {
        logger.error('Failed to get escrow by task ID', {
          taskId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      return null;
    }
  }

  /**
   * Release escrow funds to performer
   * @deprecated Use setAutoReleaseDate instead for grace period support
   */
  static async releaseEscrow(
    escrowId: string,
    releasedBy: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.baseURL || !this.serviceAuthToken) {
        this.initialize();
      }

      const response = await axios.post(
        `${this.baseURL}/api/v1/escrow/release/${escrowId}`,
        {
          releasedBy,
          metadata
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
            'X-User-Id': releasedBy
          },
          timeout: 15000
        }
      );

      if (response.data.success) {
        logger.info('Escrow released successfully', {
          escrowId,
          releasedBy,
          transaction: response.data.transaction
        });
        return { success: true };
      }

      return { success: false, error: response.data.error || 'Failed to release escrow' };
    } catch (error) {
      // Log error but don't throw - task completion should still succeed
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error('Failed to release escrow', {
          escrowId,
          releasedBy,
          status: axiosError.response?.status,
          message: axiosError.message,
          data: axiosError.response?.data
        });
      } else {
        logger.error('Failed to release escrow', {
          escrowId,
          releasedBy,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      return { success: false, error: error instanceof Error ? error.message : 'Failed to release escrow' };
    }
  }

  /**
   * Set auto-release date for escrow (with grace period)
   * Used when task completion is approved
   */
  static async setAutoReleaseDate(
    razorpayOrderId: string,
    autoReleaseDate: Date
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.baseURL || !this.serviceAuthToken) {
        this.initialize();
      }

      const response = await axios.put(
        `${this.baseURL}/api/v1/escrow/auto-release`,
        {
          razorpayOrderId,
          autoReleaseDate: autoReleaseDate.toISOString(),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
          },
          timeout: 10000
        }
      );

      if (response.data.success) {
        logger.info('Escrow auto-release date set successfully', {
          razorpayOrderId,
          autoReleaseDate: autoReleaseDate.toISOString(),
        });
        return { success: true };
      }

      return { success: false, error: response.data.error || 'Failed to set auto-release date' };
    } catch (error) {
      // Log error but don't throw - task completion should still succeed
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error('Failed to set auto-release date', {
          razorpayOrderId,
          status: axiosError.response?.status,
          message: axiosError.message,
          data: axiosError.response?.data
        });
      } else {
        logger.error('Failed to set auto-release date', {
          razorpayOrderId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      return { success: false, error: error instanceof Error ? error.message : 'Failed to set auto-release date' };
    }
  }

  /**
   * Cancel auto-release for escrow
   * Used when revision is requested after completion approval
   */
  static async cancelAutoRelease(
    razorpayOrderId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.baseURL || !this.serviceAuthToken) {
        this.initialize();
      }

      const response = await axios.put(
        `${this.baseURL}/api/v1/escrow/auto-release`,
        {
          razorpayOrderId,
          autoReleaseDate: null,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
          },
          timeout: 10000
        }
      );

      if (response.data.success) {
        logger.info('Escrow auto-release cancelled successfully', {
          razorpayOrderId,
        });
        return { success: true };
      }

      return { success: false, error: response.data.error || 'Failed to cancel auto-release' };
    } catch (error) {
      // Log error but don't throw
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error('Failed to cancel auto-release', {
          razorpayOrderId,
          status: axiosError.response?.status,
          message: axiosError.message,
          data: axiosError.response?.data
        });
      } else {
        logger.error('Failed to cancel auto-release', {
          razorpayOrderId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      return { success: false, error: error instanceof Error ? error.message : 'Failed to cancel auto-release' };
    }
  }
}


