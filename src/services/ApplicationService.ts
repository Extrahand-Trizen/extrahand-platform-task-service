import TaskApplication, { ITaskApplication } from "../models/TaskApplication";
import Task from "../models/Task";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../errors/AppError";
import logger from "../config/logger";
import { ApplicationStatus } from "../types";
import mongoose from "mongoose";
import { NotificationClient } from "./NotificationClient";
import { EmailServiceClient } from "../clients/EmailServiceClient";
import { config } from "../config/env";

export class ApplicationService {
  /**
   * Submit application for a task
   */
  static async submitApplication(
    taskId: string,
    applicantProfileId: mongoose.Types.ObjectId,
    applicantUid: string,
    applicationData: {
      proposedBudget: {
        amount: number;
        currency?: string;
        isNegotiable?: boolean;
      };
      proposedTime?: any;
      coverLetter?: string;
      relevantExperience?: string[];
      portfolio?: string[];
    }
  ): Promise<ITaskApplication> {
    // Check if task exists and is open
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    if (task.status !== "open") {
      throw new BadRequestError("Task is not open for applications");
    }

    // Compare ObjectIds
    if (task.requesterId.equals(applicantProfileId)) {
      throw new BadRequestError("Cannot apply to your own task");
    }

    // Check if user has already applied
    const existingApplication = await TaskApplication.findOne({
      taskId,
      applicantId: applicantProfileId,
    });

    if (existingApplication) {
      throw new BadRequestError("You have already applied to this task");
    }

    // Snapshot applicant profile at time of application
    const Profile = mongoose.connection.collection("profiles");
    let applicantProfileSnapshot: any | undefined;
    try {
      const applicantProfile = await Profile.findOne({
        _id: applicantProfileId,
      });
      if (applicantProfile) {
        applicantProfileSnapshot = {
          name: applicantProfile.name,
          photoURL: applicantProfile.photoURL,
          rating: applicantProfile.rating,
          totalReviews: applicantProfile.totalReviews,
          skills: applicantProfile.skills,
        };
      }
    } catch (error) {
      logger.warn("Could not snapshot applicant profile", {
        applicantProfileId,
        error:
          error instanceof Error ? error.message : "Unknown error",
      });
    }

    // Create application
    const application = await TaskApplication.create({
      taskId,
      applicantId: applicantProfileId,
      applicantProfile: applicantProfileSnapshot,
      proposedBudget: {
        amount: Number(
          applicationData.proposedBudget?.amount ||
            applicationData.proposedBudget
        ),
        currency: applicationData.proposedBudget?.currency || "INR",
        isNegotiable: applicationData.proposedBudget?.isNegotiable !== false,
      },
      proposedTime: applicationData.proposedTime || { flexible: true },
      coverLetter: applicationData.coverLetter || "",
      relevantExperience: Array.isArray(applicationData.relevantExperience)
        ? applicationData.relevantExperience
        : [],
      portfolio: Array.isArray(applicationData.portfolio)
        ? applicationData.portfolio
        : [],
    });

    // Increment task applications count (atomic operation)
    await Task.updateOne({ _id: taskId }, { $inc: { applications: 1 } });

    logger.info(
      `Application submitted: ${application._id} for task ${taskId} by user ${applicantUid}`
    );

    // EMIT: APPLICATION_SUBMITTED notification to task requester
    try {
      const Profile = mongoose.connection.collection("profiles");
      const requesterProfile = await Profile.findOne({ _id: task.requesterId });
      if (requesterProfile?.uid) {
        await NotificationClient.send(
          {
            eventKey: 'APPLICATION_SUBMITTED',
            category: 'taskUpdates',
            actorId: applicantUid,
            recipients: [requesterProfile.uid],
            entity: { type: 'application', id: application._id.toString() },
            title: `New application for: ${task.title}`,
            body: `Someone has applied to your task. Review their application to accept or reject.`,
            data: {
              taskId,
              applicationId: application._id.toString(),
              applicantUid
            }
          }
        );
      }
      // Email: application submitted → requester
      if (requesterProfile?.email) {
        const applicationUrl = `${config.WEB_APP_URL}/tasks/${taskId}/applications`;
        EmailServiceClient.sendApplicationSubmitted(requesterProfile.email, {
          requesterName: requesterProfile.name || requesterProfile.fullName || 'Task owner',
          applicantName: applicantProfileSnapshot?.name || 'An applicant',
          taskTitle: task.title,
          proposedAmount: application.proposedBudget?.amount,
          applicantMessage: application.coverLetter || undefined,
          applicantRating: applicantProfileSnapshot?.rating,
          applicantCompletedTasks: applicantProfileSnapshot?.totalReviews,
          applicationUrl,
          taskUrl: applicationUrl,
          userId: requesterProfile.uid,
        }).catch((err) =>
          logger.error('Error sending application_submitted email', {
            taskId,
            applicationId: application._id,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        );
      }
    } catch (error) {
      logger.error('Error sending APPLICATION_SUBMITTED notification', {
        taskId,
        applicationId: application._id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return application;
  }

  /**
   * Get applications with authorization checks
   */
  static async getApplications(
    currentUserProfileId: mongoose.Types.ObjectId,
    filters: {
      taskId?: string;
      mine?: boolean;
      status?: ApplicationStatus;
      limit?: number;
      page?: number;
    }
  ): Promise<{ applications: any[]; pagination: any }> {
    const { taskId, mine, status, limit = 20, page = 1 } = filters;
    const pageSize = Math.min(limit, 100);
    const pageNum = page;
    const skip = (pageNum - 1) * pageSize;

    const query: any = {};

    // Get applications for a specific task
    if (taskId) {
      const task = await Task.findById(taskId);
      if (!task) {
        throw new NotFoundError("Task not found");
      }

      const isOwner = task.requesterId.equals(currentUserProfileId);
      
      if (isOwner) {
        // Owner sees all applications for their task
        query.taskId = taskId;
      } else {
        // Non-owner sees only their own application for this task
        query.taskId = taskId;
        query.applicantId = currentUserProfileId;
      }
    }

    // Get my applications across all tasks
    if (mine) {
      query.applicantId = currentUserProfileId;
    }

    // Status filter
    if (
      status &&
      ["pending", "accepted", "rejected", "withdrawn"].includes(status)
    ) {
      query.status = status;
    }

    // Execute query - populate taskId
    const applications = await TaskApplication.find(query)
      .populate(
        "taskId",
        "title category budget location status requesterId requesterName"
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean();

    const Profile = mongoose.connection.collection("profiles");
    const enrichedApplications = await Promise.all(
      applications.map(async (app) => {
        // Prefer stored snapshot if present
        if (app.applicantProfile) {
          return app;
        }

        try {
          const applicantProfile = await Profile.findOne({
            _id: app.applicantId,
          });
          return {
            ...app,
            applicantProfile: applicantProfile
              ? {
                  name: applicantProfile.name,
                  photoURL: applicantProfile.photoURL,
                  rating: applicantProfile.rating,
                  totalReviews: applicantProfile.totalReviews,
                  skills: applicantProfile.skills,
                }
              : null,
          };
        } catch (error) {
          logger.warn(
            "Could not fetch applicant profile for",
            app.applicantId
          );
          return app;
        }
      })
    );

    // Get total count for pagination
    const total = await TaskApplication.countDocuments(query);

    const results = enrichedApplications.map((app) => ({
      id: String(app._id),
      ...app,
    }));

    return {
      applications: results,
      pagination: {
        page: pageNum,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Get a single application by ID with authorization
   */
  static async getApplicationById(
    applicationId: string,
    currentUserProfileId: mongoose.Types.ObjectId
  ): Promise<any> {
    const application = await TaskApplication.findById(applicationId)
      .populate(
        "taskId",
        "title category budget location status requesterId requesterName"
      )
      .lean();

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    // Authorization: User must be applicant or task creator
    const task = application.taskId as any;
    const applicantIdStr = application.applicantId?.toString();
    const currentUserIdStr = currentUserProfileId.toString();
    const requesterIdStr = task.requesterId?.toString();
    
    if (
      applicantIdStr !== currentUserIdStr &&
      requesterIdStr !== currentUserIdStr
    ) {
      throw new ForbiddenError("Not authorized to view this application");
    }

    // Manually fetch applicant profile
    const Profile = mongoose.connection.collection("profiles");
    const applicantProfile = await Profile.findOne({
      _id: application.applicantId,
    });

    return {
      ...application,
      id: String(application._id),
      applicantProfile: applicantProfile
        ? {
            name: applicantProfile.name,
            photoURL: applicantProfile.photoURL,
            rating: applicantProfile.rating,
            totalReviews: applicantProfile.totalReviews,
            skills: applicantProfile.skills,
          }
        : null,
    };
  }

  /**
   * Update application status (PUT endpoint)
   */
  static async updateApplication(
    applicationId: string,
    taskOwnerProfileId: mongoose.Types.ObjectId,
    taskOwnerUid: string,
    updateData: { status?: ApplicationStatus; message?: string }
  ): Promise<ITaskApplication> {
    const { status, message } = updateData;

    const application = await TaskApplication.findById(applicationId).populate(
      "taskId",
      "requesterId status title budget location scheduledDate scheduledTimeStart scheduledTimeEnd"
    );

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    // Only task creator can update application status
    const task = application.taskId as any;
    if (!task.requesterId.equals(taskOwnerProfileId)) {
      throw new ForbiddenError("Not authorized to update this application");
    }

    // STEP 1: Get old status for change detection
    const oldStatus = application.status;

    // Validate status transition
    if (status === "accepted") {
      if (task.status !== "open") {
        throw new BadRequestError("Task is not open for assignment");
      }

      // Reject all other pending applications for this task
      await TaskApplication.updateMany(
        {
          taskId: task._id,
          _id: { $ne: applicationId },
          status: "pending",
        },
        { status: "rejected" }
      );

      // Get applicant profile to set assigneeId and assigneeUid
      const Profile = mongoose.connection.collection("profiles");
      const applicantProfile = await Profile.findOne({ _id: application.applicantId });

      // Update task status to 'assigned' and set assignee
      await Task.findByIdAndUpdate(task._id, {
        status: "assigned",
        assigneeId: application.applicantId,
        assigneeUid: applicantProfile?.uid || null,
        assignedToName: applicantProfile?.name || applicantProfile?.fullName || "Assigned User",
        assignedAt: new Date(),
        updatedAt: new Date(),
      });

      logger.info(`✅ Task ${task._id} assigned to ${application.applicantId}`);
    }

    // STEP 2: Update application status
    application.status = status || application.status;
    application.updatedAt = new Date();

    // Add message if provided
    if (message) {
      if (!application.messages) {
        application.messages = [];
      }
      application.messages.push({
        senderId: taskOwnerProfileId,
        message,
        timestamp: new Date(),
        isRead: false,
      });
    }

    await application.save();

    // STEP 3: Emit notifications based on status change
    const statusChanged = oldStatus !== application.status;
    
    if (statusChanged) {
      // Fetch applicant UID for notifications
      const Profile = mongoose.connection.collection("profiles");
      const applicantProfile = await Profile.findOne({ _id: application.applicantId });
      const applicantUid = applicantProfile?.uid;

      if (application.status === 'accepted' && applicantUid) {
        // Emit APPLICATION_ACCEPTED to applicant
        try {
          await NotificationClient.send(
            {
              eventKey: 'APPLICATION_ACCEPTED',
              category: 'taskUpdates',
              actorId: taskOwnerUid,
              recipients: [applicantUid],
              entity: { type: 'application', id: applicationId },
              title: `Your application was accepted!`,
              body: `Great news! Your application for "${task.title}" has been accepted.`,
              data: {
                taskId: task._id.toString(),
                applicationId,
                status: 'accepted'
              }
            }
          );
        } catch (error) {
          logger.error('Error sending APPLICATION_ACCEPTED notification', {
            applicationId,
            taskId: task._id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        // Email: application accepted → applicant; task assigned → requester
        const taskUrl = `${config.WEB_APP_URL}/my-tasks`;
        const requesterProfileForEmail = await Profile.findOne({ _id: task.requesterId });
        const scheduledDateStr = task.scheduledDate
          ? new Date(task.scheduledDate).toLocaleDateString()
          : undefined;
        const scheduledTimeStr = task.scheduledTimeStart || task.scheduledTimeEnd
          ? [task.scheduledTimeStart, task.scheduledTimeEnd].filter(Boolean).join(' – ')
          : undefined;
        if (applicantProfile?.email) {
          EmailServiceClient.sendApplicationAccepted(applicantProfile.email, {
            applicantName: applicantProfile.name || applicantProfile.fullName || 'There',
            requesterName: requesterProfileForEmail?.name || requesterProfileForEmail?.fullName || 'The requester',
            taskTitle: task.title,
            budget: task.budget?.amount,
            location: task.location?.city || task.location?.address,
            scheduledDate: scheduledDateStr,
            scheduledTime: scheduledTimeStr,
            taskUrl,
            userId: applicantProfile.uid,
          }).catch((err) =>
            logger.error('Error sending application_accepted email', {
              applicationId,
              error: err instanceof Error ? err.message : 'Unknown error',
            })
          );
        }
        if (requesterProfileForEmail?.email) {
          EmailServiceClient.sendTaskAssignedRequester(requesterProfileForEmail.email, {
            requesterName: requesterProfileForEmail.name || requesterProfileForEmail.fullName || 'There',
            assigneeName: applicantProfile?.name || applicantProfile?.fullName || 'Tasker',
            taskTitle: task.title,
            budget: task.budget?.amount,
            scheduledDate: scheduledDateStr,
            taskUrl,
            userId: requesterProfileForEmail.uid,
          }).catch((err) =>
            logger.error('Error sending task_assigned_requester email', {
              applicationId,
              error: err instanceof Error ? err.message : 'Unknown error',
            })
          );
        }
      } else if (application.status === 'rejected' && applicantUid) {
        // Emit APPLICATION_REJECTED to applicant
        try {
          await NotificationClient.send(
            {
              eventKey: 'APPLICATION_REJECTED',
              category: 'taskUpdates',
              actorId: taskOwnerUid,
              recipients: [applicantUid],
              entity: { type: 'application', id: applicationId },
              title: `Application Update: "${task.title}"`,
              body: `Unfortunately, your application for this task was not selected. Keep applying!`,
              data: {
                taskId: task._id.toString(),
                applicationId,
                status: 'rejected'
              }
            }
          );
        } catch (error) {
          logger.error('Error sending APPLICATION_REJECTED notification', {
            applicationId,
            taskId: task._id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        // Email: application rejected → applicant
        if (applicantProfile?.email) {
          EmailServiceClient.sendApplicationRejected(applicantProfile.email, {
            applicantName: applicantProfile.name || applicantProfile.fullName || 'There',
            taskTitle: task.title,
            taskUrl: `${config.WEB_APP_URL}/my-tasks`,
            userId: applicantProfile.uid,
          }).catch((err) =>
            logger.error('Error sending application_rejected email', {
              applicationId,
              error: err instanceof Error ? err.message : 'Unknown error',
            })
          );
        }
      }
    }

    return application;
  }

  /**
   * Accept an application
   */
  static async acceptApplication(
    applicationId: string,
    taskOwnerProfileId: mongoose.Types.ObjectId,
    taskOwnerUid: string
  ): Promise<ITaskApplication> {
    return this.updateApplication(applicationId, taskOwnerProfileId, taskOwnerUid, {
      status: "accepted",
    });
  }

  /**
   * Reject an application
   */
  static async rejectApplication(
    applicationId: string,
    taskOwnerProfileId: mongoose.Types.ObjectId,
    taskOwnerUid: string
  ): Promise<ITaskApplication> {
    return this.updateApplication(applicationId, taskOwnerProfileId, taskOwnerUid, {
      status: "rejected",
    });
  }

  /**
   * Withdraw an application (alias for withdrawPendingApplication)
   */
  static async withdrawApplication(
    applicationId: string,
    applicantProfileId: mongoose.Types.ObjectId
  ): Promise<void> {
    return this.withdrawPendingApplication(applicationId, applicantProfileId);
  }

  /**
   * Withdraw a pending application
   */
  static async withdrawPendingApplication(
    applicationId: string,
    applicantProfileId: mongoose.Types.ObjectId
  ): Promise<void> {
    const application = await TaskApplication.findById(applicationId);
    if (!application) {
      throw new NotFoundError("Application not found");
    }

    if (!application.applicantId.equals(applicantProfileId)) {
      throw new ForbiddenError(
        "Only the applicant can withdraw the application"
      );
    }

    if (application.status !== "pending") {
      throw new BadRequestError("Can only withdraw pending applications");
    }

    application.status = "withdrawn";
    application.updatedAt = new Date();
    await application.save();

    logger.info(
      `Application withdrawn: ${applicationId} by user ${applicantProfileId.toString()}`
    );

    // Email: application withdrawn → requester
    try {
      const task = await Task.findById(application.taskId);
      if (task) {
        const Profile = mongoose.connection.collection("profiles");
        const requesterProfile = await Profile.findOne({ _id: task.requesterId });
        const applicantProfile = await Profile.findOne({ _id: application.applicantId });
        if (requesterProfile?.email) {
          EmailServiceClient.sendApplicationWithdrawn(requesterProfile.email, {
            requesterName: requesterProfile.name || requesterProfile.fullName || 'There',
            applicantName: applicantProfile?.name || applicantProfile?.fullName || 'An applicant',
            taskTitle: task.title,
            taskUrl: `${config.WEB_APP_URL}/tasks/${task._id}/applications`,
            applicationUrl: `${config.WEB_APP_URL}/my-tasks`,
            userId: requesterProfile.uid,
          }).catch((err) =>
            logger.error('Error sending application_withdrawn email', {
              applicationId,
              error: err instanceof Error ? err.message : 'Unknown error',
            })
          );
        }
      }
    } catch (error) {
      logger.error('Error sending application_withdrawn email', {
        applicationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  static async withdrawAcceptedApplication(
    applicationId: string,
    applicantProfileId: mongoose.Types.ObjectId
  ): Promise<void> {
    const application = await TaskApplication.findById(applicationId);
    if (!application) {
      throw new NotFoundError("Application not found");
    }

    if (!application.applicantId.equals(applicantProfileId)) {
      throw new ForbiddenError("Only the applicant can withdraw");
    }

    if (application.status !== "accepted") {
      throw new BadRequestError("Only accepted applications can be withdrawn");
    }

    // 1️⃣ Mark application withdrawn
    application.status = "withdrawn";
    application.updatedAt = new Date();
    await application.save();

    // 2️⃣ Reset task to OPEN
    await Task.updateOne(
      { _id: application.taskId },
      {
        status: "open",
        assigneeId: null,
        assignedAt: null,
        updatedAt: new Date(),
      }
    );

    logger.warn(`Accepted application withdrawn: ${applicationId}`);

    // 3️⃣ (Optional but recommended)
    // Cancel escrow, notify poster, etc.
    // These should be NON-BLOCKING
  }
}
