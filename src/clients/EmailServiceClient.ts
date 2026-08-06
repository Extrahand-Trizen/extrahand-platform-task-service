import axios, { AxiosError } from 'axios';
import logger from '../config/logger';
import { config } from '../config/env';
import { NotificationPreferenceChecker } from '../services/NotificationPreferenceChecker';

/**
 * EmailServiceClient – HTTP client for extrahand-email-service.
 * Used for task/application notification emails (application submitted, accepted, rejected,
 * task posted confirmation, task assigned, task cancelled, etc.).
 */
export class EmailServiceClient {
  private static baseURL: string = '';
  private static serviceAuthToken: string = '';
  private static webAppUrl: string = '';
  private static isInitialized: boolean = false;
  private static serviceName: string = 'task-service';

  static initialize(baseURL?: string): void {
    this.baseURL = baseURL || config.EMAIL_SERVICE_URL;
    this.serviceAuthToken = config.SERVICE_AUTH_TOKEN || '';
    this.webAppUrl = config.WEB_APP_URL;
    this.isInitialized = true;
    logger.info('EmailServiceClient initialized', {
      baseURL: this.baseURL,
      hasAuthToken: !!this.serviceAuthToken,
    });
    if (!this.serviceAuthToken) {
      logger.warn('EmailServiceClient: SERVICE_AUTH_TOKEN not set – email requests will fail');
    }
  }

  private static ensureInitialized(): void {
    if (!this.isInitialized) {
      this.initialize();
    }
  }

  private static isValidEmail(email: string): boolean {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return false;
    const reserved = ['example.com', 'example.net', 'example.org', 'test', 'localhost', 'invalid'];
    const domain = email.split('@')[1]?.toLowerCase();
    if (reserved.some((r) => domain === r || domain?.endsWith(`.${r}`))) {
      logger.warn('EmailServiceClient: Skipping reserved domain', { email, domain });
      return false;
    }
    return true;
  }

  private static async sendRequest(endpoint: string, data: Record<string, unknown>): Promise<boolean> {
    this.ensureInitialized();
    const email = (data.email as string) || (data.to as string);
    if (!this.isValidEmail(email)) {
      logger.warn('EmailServiceClient: Skipping – invalid or placeholder email', { email, endpoint });
      return false;
    }
    try {
      logger.info('EmailServiceClient: Sending email request', {
        endpoint,
        to: email,
        template: data.template,
        subject: data.subject,
      });
      await axios.post(`${this.baseURL}/api/v1/email${endpoint}`, data, {
        headers: {
          'X-Service-Auth': this.serviceAuthToken,
          'X-Service-Name': this.serviceName,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      logger.info('EmailServiceClient: Email request successful', {
        endpoint,
        to: email,
        template: data.template,
      });
      return true;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('EmailServiceClient: Send failed', {
        endpoint,
        to: email,
        template: data.template,
        subject: data.subject,
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return false;
    }
  }

  private static resolveCategoryForTemplate(
    template: string
  ): 'taskUpdates' | 'taskReminders' | 'keywordTaskAlerts' | 'recommendedTaskAlerts' | 'payments' {
    switch (template) {
      case 'task_created_recommended':
        return 'recommendedTaskAlerts';
      case 'task_created_keyword':
        return 'keywordTaskAlerts';
      case 'task_reminder':
        return 'taskReminders';
      case 'task_start_otp':
        return 'payments';
      default:
        return 'taskUpdates';
    }
  }

  private static async sendTemplate(to: string, template: string, data: Record<string, unknown>): Promise<boolean> {
    const userId = typeof data.userId === 'string' ? data.userId : '';
    const category = this.resolveCategoryForTemplate(template);

    if (!userId) {
      logger.warn('EmailServiceClient: Skipping notification email because userId is missing', {
        template,
        to,
        category,
      });
      return false;
    }

    const emailEnabled = await NotificationPreferenceChecker.isEmailNotificationEnabled(userId, category);
    if (!emailEnabled) {
      logger.info('EmailServiceClient: Skipping notification email due to user preferences', {
        template,
        userId,
        category,
      });
      return false;
    }

    return this.sendRequest('/send', {
      to,
      template,
      data: { ...data, platformName: data.platformName || 'ExtraHand' },
    });
  }

  // ----- Task & application emails -----

  static sendTaskPostedConfirmation(to: string, data: {
    requesterName: string;
    taskTitle: string;
    taskUrl?: string;
    budget?: number;
    category?: string;
    location?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'task_posted_confirmation', {
      ...data,
      taskUrl,
    });
  }

  static sendApplicationSubmitted(to: string, data: {
    requesterName: string;
    applicantName: string;
    taskTitle: string;
    proposedAmount?: number;
    applicantMessage?: string;
    applicantRating?: number;
    applicantCompletedTasks?: number;
    applicationUrl?: string;
    taskUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const applicationUrl = data.applicationUrl || data.taskUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'application_submitted', {
      ...data,
      applicationUrl,
      taskUrl: applicationUrl,
    });
  }

  static sendApplicationAccepted(to: string, data: {
    applicantName: string;
    requesterName: string;
    taskTitle: string;
    budget?: number;
    location?: string;
    scheduledDate?: string;
    scheduledTime?: string;
    taskUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'application_accepted', { ...data, taskUrl });
  }

  static sendApplicationRejected(to: string, data: {
    applicantName: string;
    taskTitle: string;
    taskDescription?: string;
    taskUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'application_rejected', { ...data, taskUrl });
  }

  static sendTaskAssignedRequester(to: string, data: {
    requesterName: string;
    assigneeName: string;
    taskTitle: string;
    budget?: number;
    scheduledDate?: string;
    taskUrl?: string;
    chatUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || data.chatUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'task_assigned_requester', { ...data, taskUrl, chatUrl: taskUrl });
  }

  static sendTaskCancelled(to: string, data: {
    recipientName: string;
    taskTitle: string;
    cancelledByName?: string;
    reason?: string;
    browseUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const browseUrl = data.browseUrl || `${this.webAppUrl || 'https://extrahand.in'}/tasks`;
    return this.sendTemplate(to, 'task_cancelled', { ...data, browseUrl });
  }

  static sendTaskStarted(to: string, data: {
    requesterName: string;
    assigneeName: string;
    taskTitle: string;
    startedAt?: string;
    taskUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'task_started', { ...data, taskUrl });
  }

  static sendCompletionProofSubmitted(to: string, data: {
    requesterName: string;
    assigneeName: string;
    taskTitle: string;
    submittedAt?: string;
    taskUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'completion_proof_submitted', { ...data, taskUrl });
  }

  static sendApplicationWithdrawn(to: string, data: {
    requesterName: string;
    applicantName: string;
    taskTitle: string;
    taskUrl?: string;
    applicationUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || data.applicationUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'application_withdrawn', { ...data, taskUrl, applicationUrl: taskUrl });
  }

  static sendTaskCompleted(to: string, data: {
    recipientName: string;
    taskTitle: string;
    isTasker: boolean;
    completedDate?: string;
    amount?: number;
    payoutInfo?: string;
    reviewUrl?: string;
    taskUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || data.reviewUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'task_completed', { ...data, taskUrl, reviewUrl: data.reviewUrl || taskUrl });
  }

  static sendReviewRequest(to: string, data: {
    reviewerName: string;
    revieweeName: string;
    taskTitle: string;
    isRequester: boolean;
    completedDate?: string;
    reviewUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const reviewUrl = data.reviewUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'review_request', { ...data, reviewUrl });
  }

  static sendTaskUpdated(to: string, data: {
    recipientName: string;
    taskTitle: string;
    changes?: Array<{ field: string; oldValue?: string; newValue: string }>;
    updateNote?: string;
    taskUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'task_updated', { ...data, taskUrl });
  }

  static sendTaskReminder(to: string, data: {
    recipientName: string;
    taskTitle: string;
    scheduledDate?: string;
    scheduledTime?: string;
    location?: string;
    isTasker: boolean;
    otherPartyName?: string;
    taskUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'task_reminder', { ...data, taskUrl });
  }

  static sendTaskCreatedRecommended(to: string, data: {
    taskerName: string;
    taskTitle: string;
    skillCategory?: string;
    taskDescription?: string;
    budget?: number;
    location?: string;
    scheduledDate?: string;
    category?: string;
    taskUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || `${this.webAppUrl || 'https://extrahand.in'}/tasks`;
    return this.sendTemplate(to, 'task_created_recommended', { ...data, taskUrl });
  }

  static sendTaskCreatedKeyword(to: string, data: {
    userName: string;
    taskTitle: string;
    matchedKeyword?: string;
    taskDescription?: string;
    budget?: number;
    location?: string;
    scheduledDate?: string;
    taskUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || `${this.webAppUrl || 'https://extrahand.in'}/tasks`;
    return this.sendTemplate(to, 'task_created_keyword', { ...data, taskUrl });
  }

  static sendChangesRequested(to: string, data: {
    assigneeName: string;
    requesterName: string;
    taskTitle: string;
    message: string;
    taskUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'changes_requested', { ...data, taskUrl });
  }

  /**
   * Send task start OTP to requester (poster)
   * Sent when tasker clicks "Start Task" and OTP is generated
   */
  static sendTaskStartOtp(to: string, data: {
    requesterName: string;
    taskerName: string;
    taskTitle: string;
    otp: string;
    taskUrl?: string;
    platformName?: string;
    userId?: string;
  }): Promise<boolean> {
    const taskUrl = data.taskUrl || `${this.webAppUrl || 'https://extrahand.in'}/my-tasks`;
    return this.sendTemplate(to, 'task_start_otp', { ...data, taskUrl });
  }
}
