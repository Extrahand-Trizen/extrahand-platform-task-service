import axios, { AxiosError } from 'axios';
import logger from '../config/logger';
import { validateEnv } from '../config/env';

/**
 * EmailServiceClient
 * 
 * HTTP-based client for calling email-service APIs
 * Handles all task-related email notifications
 * 
 * Usage:
 * EmailServiceClient.initialize();
 * await EmailServiceClient.sendApplicationAccepted(email, applicantName, taskTitle, ...);
 */
export class EmailServiceClient {
  private static baseURL: string = 'http://localhost:4007';
  private static serviceAuthToken: string = '';
  private static isInitialized: boolean = false;
  private static serviceName: string = 'task-service';

  /**
   * Initialize EmailServiceClient with required config
   * MUST be called once at app startup
   */
  static initialize(baseURL?: string): void {
    const env = validateEnv();
    this.baseURL = baseURL || process.env.EMAIL_SERVICE_URL || 'http://localhost:4007';
    this.serviceAuthToken = env.SERVICE_AUTH_TOKEN || '';
    this.isInitialized = true;

    logger.info('EmailServiceClient initialized', {
      baseURL: this.baseURL,
      hasAuthToken: !!this.serviceAuthToken
    });

    if (!this.serviceAuthToken) {
      logger.warn('EmailServiceClient initialized without SERVICE_AUTH_TOKEN');
    }
  }

  private static ensureInitialized(): void {
    if (!this.isInitialized) {
      logger.warn('EmailServiceClient: Not initialized, calling initialize with defaults');
      this.initialize();
    }
  }

  /**
   * Validate email address before sending
   * Prevents sending to placeholder/reserved addresses (RFC 2606)
   */
  private static isValidEmail(email: string): boolean {
    if (!email || typeof email !== 'string') return false;
    
    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return false;
    
    // Block RFC 2606 reserved domains
    const reservedDomains = ['example.com', 'example.net', 'example.org', 'test', 'localhost', 'invalid'];
    const domain = email.split('@')[1]?.toLowerCase();
    if (reservedDomains.some(reserved => domain === reserved || domain?.endsWith(`.${reserved}`))) {
      logger.warn('EmailServiceClient: Skipping email to reserved/placeholder domain', { email, domain });
      return false;
    }
    
    return true;
  }

  private static async sendRequest(endpoint: string, data: any): Promise<boolean> {
    this.ensureInitialized();

    // Validate email address
    const email = data.to || data.email;
    if (!this.isValidEmail(email)) {
      logger.warn('EmailServiceClient: Skipping email - invalid or placeholder address', { 
        email, 
        endpoint 
      });
      return false;
    }

    try {
      logger.info('EmailServiceClient: Sending email request', { 
        endpoint, 
        to: email 
      });

      await axios.post(
        `${this.baseURL}/api/v1/email${endpoint}`,
        data,
        {
          headers: {
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': this.serviceName,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      logger.info('EmailServiceClient: Email request successful', { endpoint });
      return true;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('EmailServiceClient: Failed to send email', {
        endpoint,
        status: axiosError.response?.status,
        message: axiosError.message
      });
      return false;
    }
  }

  // ============ Task Recommendation Emails ============

  /**
   * Send task recommendation email (skill match)
   */
  static async sendTaskRecommendation(
    email: string,
    taskerName: string,
    taskDetails: {
      taskId: string;
      taskTitle: string;
      taskDescription?: string;
      budget?: number;
      location?: string;
      scheduledDate?: string;
      category?: string;
      skillCategory?: string;
    }
  ): Promise<boolean> {
    const env = validateEnv();
    return this.sendRequest('/send', {
      to: email,
      subject: '🎯 New Task Matches Your Skills - ExtraHand',
      template: 'task_created_recommended',
      data: {
        taskerName,
        ...taskDetails,
        taskUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/tasks/${taskDetails.taskId}`
      }
    });
  }

  /**
   * Send task keyword alert email
   */
  static async sendTaskKeywordAlert(
    email: string,
    userName: string,
    matchedKeyword: string,
    taskDetails: {
      taskId: string;
      taskTitle: string;
      taskDescription?: string;
      budget?: number;
      location?: string;
      scheduledDate?: string;
    }
  ): Promise<boolean> {
    const env = validateEnv();
    return this.sendRequest('/send', {
      to: email,
      subject: '🔔 Task Alert: Matches Your Keywords - ExtraHand',
      template: 'task_created_keyword',
      data: {
        userName,
        matchedKeyword,
        ...taskDetails,
        taskUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/tasks/${taskDetails.taskId}`
      }
    });
  }

  // ============ Application Emails ============

  /**
   * Send application submitted notification (to requester)
   */
  static async sendApplicationSubmitted(
    requesterEmail: string,
    requesterName: string,
    taskId: string,
    taskTitle: string,
    applicantDetails: {
      applicantName: string;
      applicantRating?: number;
      applicantCompletedTasks?: number;
      proposedAmount?: number;
      applicantMessage?: string;
    }
  ): Promise<boolean> {
    const env = validateEnv();
    return this.sendRequest('/send', {
      to: requesterEmail,
      subject: '📝 New Application Received - ExtraHand',
      template: 'application_submitted',
      data: {
        requesterName,
        taskTitle,
        ...applicantDetails,
        taskUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/tasks/${taskId}`,
        applicationUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/tasks/${taskId}/applications`
      }
    });
  }

  /**
   * Send application accepted notification (to applicant)
   */
  static async sendApplicationAccepted(
    applicantEmail: string,
    applicantName: string,
    requesterName: string,
    taskDetails: {
      taskId: string;
      taskTitle: string;
      budget?: number;
      location?: string;
      scheduledDate?: string;
      scheduledTime?: string;
    }
  ): Promise<boolean> {
    const env = validateEnv();
    return this.sendRequest('/send', {
      to: applicantEmail,
      subject: '🎉 Your Application Was Accepted! - ExtraHand',
      template: 'application_accepted',
      data: {
        applicantName,
        requesterName,
        ...taskDetails,
        taskUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/tasks/${taskDetails.taskId}`
      }
    });
  }

  /**
   * Send application rejected notification (to applicant)
   */
  static async sendApplicationRejected(
    applicantEmail: string,
    applicantName: string,
    taskTitle: string,
    taskDescription?: string
  ): Promise<boolean> {
    return this.sendRequest('/send', {
      to: applicantEmail,
      subject: 'Application Update - ExtraHand',
      template: 'application_rejected',
      data: {
        applicantName,
        taskTitle,
        taskDescription
      }
    });
  }

  // ============ Task Status Emails ============

  /**
   * Send task updated notification
   */
  static async sendTaskUpdated(
    recipientEmail: string,
    recipientName: string,
    taskId: string,
    taskTitle: string,
    changes?: Array<{ field: string; oldValue?: string; newValue: string }>,
    updateNote?: string
  ): Promise<boolean> {
    const env = validateEnv();
    return this.sendRequest('/send', {
      to: recipientEmail,
      subject: '📍 Task Updated - ExtraHand',
      template: 'task_updated',
      data: {
        recipientName,
        taskTitle,
        changes,
        updateNote,
        taskUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/tasks/${taskId}`
      }
    });
  }

  /**
   * Send task reminder (24h before)
   */
  static async sendTaskReminder(
    recipientEmail: string,
    recipientName: string,
    isTasker: boolean,
    taskDetails: {
      taskId: string;
      taskTitle: string;
      scheduledDate: string;
      scheduledTime?: string;
      location?: string;
      otherPartyName?: string;
    }
  ): Promise<boolean> {
    const env = validateEnv();
    return this.sendRequest('/send', {
      to: recipientEmail,
      subject: `⏰ Task Reminder: ${taskDetails.taskTitle} Tomorrow - ExtraHand`,
      template: 'task_reminder',
      data: {
        recipientName,
        isTasker,
        ...taskDetails,
        taskUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/tasks/${taskDetails.taskId}`,
        chatUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/chat`
      }
    });
  }

  /**
   * Send task completed notification
   */
  static async sendTaskCompleted(
    recipientEmail: string,
    recipientName: string,
    isTasker: boolean,
    taskDetails: {
      taskId: string;
      taskTitle: string;
      completedDate?: string;
      amount?: number;
      payoutInfo?: string;
    }
  ): Promise<boolean> {
    const env = validateEnv();
    return this.sendRequest('/send', {
      to: recipientEmail,
      subject: '✅ Task Completed Successfully - ExtraHand',
      template: 'task_completed',
      data: {
        recipientName,
        isTasker,
        ...taskDetails,
        taskUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/tasks/${taskDetails.taskId}`,
        reviewUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/tasks/${taskDetails.taskId}/review`
      }
    });
  }

  /**
   * Send review request
   */
  static async sendReviewRequest(
    reviewerEmail: string,
    reviewerName: string,
    revieweeName: string,
    isRequester: boolean,
    taskDetails: {
      taskId: string;
      taskTitle: string;
      completedDate?: string;
    }
  ): Promise<boolean> {
    const env = validateEnv();
    return this.sendRequest('/send', {
      to: reviewerEmail,
      subject: '⭐ Please Leave a Review - ExtraHand',
      template: 'review_request',
      data: {
        reviewerName,
        revieweeName,
        isRequester,
        ...taskDetails,
        reviewUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/tasks/${taskDetails.taskId}/review`
      }
    });
  }
}
