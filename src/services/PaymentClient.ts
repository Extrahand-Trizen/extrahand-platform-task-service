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
   * Create Book Now escrow (no performer until ops assigns)
   */
  static async createBookingEscrow(params: {
    taskId: string;
    bookingOrderId: string;
    posterUid: string;
    amount: number;
    taskAmount?: number;
    taskCategory?: string;
    taskTitle?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ success: boolean; escrow?: any; order?: any; error?: string }> {
    try {
      if (!this.baseURL || !this.serviceAuthToken) {
        this.initialize();
      }

      const response = await axios.post(
        `${this.baseURL}/api/v1/escrow/create-booking`,
        params,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
          },
          timeout: 15000,
        }
      );

      if (response.data.success) {
        return {
          success: true,
          escrow: response.data.escrow,
          order: response.data.order,
        };
      }

      return {
        success: false,
        error: response.data.error || 'Failed to create booking escrow',
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const ax = error as AxiosError<{ error?: string }>;
        return {
          success: false,
          error: ax.response?.data?.error || ax.message,
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create booking escrow',
      };
    }
  }

  /**
   * Attach performer after manual ops assignment
   */
  static async attachPerformerToEscrow(params: {
    escrowId: string;
    performerUid: string;
    applicationId?: string;
  }): Promise<{ success: boolean; escrow?: any; error?: string }> {
    try {
      if (!this.baseURL || !this.serviceAuthToken) {
        this.initialize();
      }

      const response = await axios.patch(
        `${this.baseURL}/api/v1/escrow/${encodeURIComponent(params.escrowId)}/attach-performer`,
        {
          performerUid: params.performerUid,
          applicationId: params.applicationId,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
          },
          timeout: 15000,
        }
      );

      if (response.data.success) {
        return { success: true, escrow: response.data.escrow };
      }

      return {
        success: false,
        error: response.data.error || 'Failed to attach performer',
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const ax = error as AxiosError<{ error?: string }>;
        return {
          success: false,
          error: ax.response?.data?.error || ax.message,
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to attach performer',
      };
    }
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
      // 404 means no escrow exists for this task (allowed path).
      // Any other failure must bubble up so cancellation doesn't silently skip refund logic.
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
        throw new Error(
          axiosError.response?.data && typeof axiosError.response.data === 'object'
            ? JSON.stringify(axiosError.response.data)
            : `Failed to get escrow by task ID: ${axiosError.message}`
        );
      } else {
        logger.error('Failed to get escrow by task ID', {
          taskId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error instanceof Error
          ? error
          : new Error('Failed to get escrow by task ID');
      }
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

  /**
   * Process payout directly when task completion is approved (non-escrow flow)
   */
  static async processTaskCompletionPayout(params: {
    taskId: string;
    performerUid: string;
    amount: number;
    taskTitle?: string;
  }): Promise<{ success: boolean; payout?: any; requiresBankAccount?: boolean; error?: string }> {
    try {
      if (!this.baseURL || !this.serviceAuthToken) {
        this.initialize();
      }

      logger.info('➡️ Calling payment-service task completion payout', {
        url: `${this.baseURL}/api/v1/payouts/task-completion`,
        taskId: params.taskId,
        performerUid: params.performerUid,
        amount: params.amount,
      });

      const response = await axios.post(
        `${this.baseURL}/api/v1/payouts/task-completion`,
        params,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
          },
          timeout: 15000,
        }
      );

      logger.info('⬅️ payment-service payout response', {
        taskId: params.taskId,
        httpStatus: response.status,
        responseSuccess: response.data?.success,
        requiresBankAccount: response.data?.requiresBankAccount,
        payoutId: response.data?.payout?.payoutId,
      });

      if (response.data.success) {
        return {
          success: true,
          payout: response.data.payout,
        };
      }

      return {
        success: false,
        requiresBankAccount: response.data.requiresBankAccount,
        error: response.data.error || 'Failed to process payout',
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<any>;
        logger.error('❌ payment-service payout call failed', {
          taskId: params.taskId,
          performerUid: params.performerUid,
          httpStatus: axiosError.response?.status,
          responseData: axiosError.response?.data,
          message: axiosError.message,
        });
        return {
          success: false,
          requiresBankAccount: Boolean(axiosError.response?.data?.requiresBankAccount),
          error: axiosError.response?.data?.error || axiosError.message,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process payout',
      };
    }
  }

  /**
   * Partial refund for one Book Now line item (multi-service checkout).
   */
  static async partialRefundBookNowLineItem(params: {
    bookingOrderId: string;
    taskId: string;
    lineAmountRupees: number;
    taskStartDate: string;
    assignedAt?: string | null;
    reason?: string;
    userId: string;
    taskTitle?: string;
    isLastActiveItem: boolean;
    catalogId?: string;
    partnerReachedLocation?: boolean;
  }): Promise<{ success: boolean; refund?: unknown; error?: string }> {
    try {
      if (!this.baseURL || !this.serviceAuthToken) {
        this.initialize();
      }

      const response = await axios.post(
        `${this.baseURL}/api/v1/payment/book-now/cancel-line-item`,
        params,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
          },
          timeout: 30000,
        },
      );

      if (response.data?.success) {
        return { success: true, refund: response.data.refund };
      }

      return {
        success: false,
        error: response.data?.error || 'Failed to process partial refund',
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const ax = error as AxiosError<{ error?: string }>;
        return {
          success: false,
          error: ax.response?.data?.error || ax.message,
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process partial refund',
      };
    }
  }

  /**
   * Cancel escrow / trigger Razorpay payment refund when a task is cancelled (service-to-service).
   * POST /api/v1/payment/cancel
   */
  static async cancelPaymentForTask(params: {
    taskId: string;
    reason?: string;
    userId?: string;
    cancelledBy: 'poster' | 'performer';
    taskStartDate: string;
    assignedAt?: string | null;
    /** Task budget (rupees) — %-fee base to match cancel UI */
    feeBaseAmount?: number;
    taskTitle?: string;
    catalogId?: string;
    partnerReachedLocation?: boolean;
  }): Promise<{
    success: boolean;
    cancelled?: boolean;
    refundRequired?: boolean;
    refund?: unknown;
    error?: string;
  }> {
    try {
      if (!this.baseURL || !this.serviceAuthToken) {
        this.initialize();
      }

      logger.info('[PaymentClient.cancelPaymentForTask] Calling payment cancel API', {
        baseURL: this.baseURL,
        taskId: params.taskId,
        cancelledBy: params.cancelledBy,
        taskStartDate: params.taskStartDate,
        hasAssignedAt: Boolean(params.assignedAt),
        feeBaseAmount: params.feeBaseAmount,
      });

      const response = await axios.post(
        `${this.baseURL}/api/v1/payment/cancel`,
        {
          taskId: params.taskId,
          reason: params.reason,
          userId: params.userId,
          cancelledBy: params.cancelledBy,
          taskStartDate: params.taskStartDate,
          assignedAt: params.assignedAt ?? undefined,
          feeBaseAmount: params.feeBaseAmount,
          taskTitle: params.taskTitle,
          catalogId: params.catalogId,
          partnerReachedLocation: params.partnerReachedLocation,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
          },
          timeout: 30000,
        }
      );

      const data = response.data;
      logger.info('[PaymentClient.cancelPaymentForTask] Cancel API response received', {
        httpStatus: response.status,
        success: Boolean(data?.success),
        cancelled: data?.cancelled,
        refundRequired: data?.refundRequired,
        refund: data?.refund,
        error: data?.error || data?.message,
      });

      if (data?.success) {
        return {
          success: true,
          cancelled: data.cancelled,
          refundRequired: data.refundRequired,
          refund: data.refund,
        };
      }

      return {
        success: false,
        error: data?.error || data?.message || 'Failed to cancel payment',
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const ax = error as AxiosError<{ error?: string; message?: string }>;
        logger.error('[PaymentClient.cancelPaymentForTask] Cancel API call failed', {
          taskId: params.taskId,
          cancelledBy: params.cancelledBy,
          httpStatus: ax.response?.status,
          responseData: ax.response?.data,
          message: ax.message,
        });
        return {
          success: false,
          error: ax.response?.data?.error || ax.response?.data?.message || ax.message,
        };
      }
      logger.error('[PaymentClient.cancelPaymentForTask] Cancel API call failed (non-axios)', {
        taskId: params.taskId,
        cancelledBy: params.cancelledBy,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel payment',
      };
    }
  }
}


