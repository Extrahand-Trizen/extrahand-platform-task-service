import TaskApplication, { ITaskApplication } from "../models/TaskApplication";
import Task from "../models/Task";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "../errors/AppError";
import logger from "../config/logger";
import { ApplicationStatus } from "../types";
import mongoose from "mongoose";
import { NotificationClient } from "./NotificationClient";
import { EmailServiceClient } from "../clients/EmailServiceClient";
import { NotificationPreferenceChecker } from "./NotificationPreferenceChecker";
import { config } from "../config/env";
import { InAppNotificationClient } from "../clients/InAppNotificationClient";

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
      selectedDates?: Array<string | Date>;
      coverLetter?: string;
      relevantExperience?: string[];
      portfolio?: string[];
    }
  ): Promise<ITaskApplication> {
    try {
      // Check if task exists and is open
      logger.debug(`[ApplicationService.submitApplication] Searching for task: ${taskId}`);
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

      const selectedDates = Array.isArray(applicationData.selectedDates)
        ? applicationData.selectedDates
            .map((value) => new Date(value))
            .filter((date) => !Number.isNaN(date.getTime()))
        : [];

      if (task.recurring?.enabled) {
        if (selectedDates.length === 0) {
          throw new BadRequestError("Please select at least one date");
        }

        const schedule = Array.isArray(task.schedule) ? task.schedule : [];
        const openDates = new Set(
          schedule
            .filter((entry: any) => entry.status === "open")
            .map((entry: any) => new Date(entry.date).toDateString())
        );

        const allValid = selectedDates.every((date) =>
          openDates.has(date.toDateString())
        );

        if (!allValid) {
          throw new BadRequestError(
            "One or more selected dates are not available"
          );
        }
      }

      // Prevent taskers with an active task from applying to new ones
      const activeStatuses = ["assigned", "started", "in_progress", "review"];
      const hasActiveTask = await Task.exists({
        assigneeId: applicantProfileId,
        status: { $in: activeStatuses },
      });

      if (hasActiveTask) {
        throw new BadRequestError(
          "You already have a task in progress. Please complete or cancel it before applying to another task."
        );
      }

      // Check if user has an active application (withdrawn/rejected do not count; user may apply again)
      logger.debug(`[ApplicationService.submitApplication] Checking for existing application: taskId=${taskId}, applicantUid=${applicantUid}`);
      const existingApplication = await TaskApplication.findOne({
        taskId,
        applicantUid: applicantUid,
        status: { $nin: ['withdrawn', 'rejected'] },
      });

      if (existingApplication) {
        throw new BadRequestError("You have already applied to this task");
      }

      // Snapshot applicant profile at time of application
      logger.debug(`[ApplicationService.submitApplication] Creating profile snapshot for applicantId=${applicantProfileId}`);
      
      // ✅ Use applicant profile data from gateway if provided (enriched request body)
      let applicantProfileSnapshot: any | undefined;
      const appData = applicationData as any; // Allow dynamic properties from gateway
      if (appData.applicantName || appData.applicantPhotoURL) {
        applicantProfileSnapshot = {
          name: appData.applicantName,
          photoURL: appData.applicantPhotoURL,
          rating: appData.applicantRating,
          totalReviews: appData.applicantTotalReviews,
        };
        logger.info(`[ApplicationService.submitApplication] Profile snapshot captured from gateway enrichment`, {
          applicantId: applicantProfileId.toString(),
          name: applicantProfileSnapshot.name,
          rating: applicantProfileSnapshot.rating
        });
      } else {
        // Fallback: fetch from database if not provided by gateway
        try {
          // Try to use Mongoose model first if available
          const profileModel = mongoose.connection.model("Profile");
          const applicantProfile = await profileModel.findById(applicantProfileId);
          if (applicantProfile) {
            applicantProfileSnapshot = {
              name: applicantProfile.name || applicantProfile.fullName,
              photoURL: applicantProfile.photoURL,
              rating: applicantProfile.rating,
              totalReviews: applicantProfile.totalReviews,
              skills: applicantProfile.skills,
            };
            logger.info(`[ApplicationService.submitApplication] Profile snapshot captured from Mongoose`, {
              applicantId: applicantProfileId.toString(),
              name: applicantProfileSnapshot.name,
              rating: applicantProfileSnapshot.rating
            });
          }
        } catch (error) {
          // Fallback: try raw collection access
          try {
            const Profile = mongoose.connection.collection("profiles");
            const applicantProfile = await Profile.findOne({
              _id: new mongoose.Types.ObjectId(applicantProfileId),
            });
            if (applicantProfile) {
              applicantProfileSnapshot = {
                name: applicantProfile.name || applicantProfile.fullName,
                photoURL: applicantProfile.photoURL,
                rating: applicantProfile.rating,
                totalReviews: applicantProfile.totalReviews,
                skills: applicantProfile.skills,
              };
              logger.info(`[ApplicationService.submitApplication] Profile snapshot captured from raw collection`, {
                applicantId: applicantProfileId.toString(),
                name: applicantProfileSnapshot.name,
                rating: applicantProfileSnapshot.rating
              });
            }
          } catch (fallbackError) {
            logger.warn("Could not snapshot applicant profile", {
              applicantProfileId,
              error:
                fallbackError instanceof Error ? fallbackError.message : "Unknown error",
            });
          }
        }
      }

      // Create application
      logger.debug(`[ApplicationService.submitApplication] Creating new application for taskId=${taskId}`);
      const proposedAmount = Number(
        applicationData.proposedBudget?.amount || applicationData.proposedBudget
      );
      const application = await TaskApplication.create({
        taskId,
        applicantId: applicantProfileId,
        applicantUid: applicantUid,
        applicantProfile: applicantProfileSnapshot,
        proposedBudget: {
          amount: proposedAmount,
          currency: applicationData.proposedBudget?.currency || "INR",
          isNegotiable: applicationData.proposedBudget?.isNegotiable !== false,
        },
        negotiation: {
          currentAmount: proposedAmount,
          status: "none",
          history: [],
        },
        proposedTime: applicationData.proposedTime || { flexible: true },
        selectedDates: selectedDates,
        coverLetter: applicationData.coverLetter || "",
        relevantExperience: Array.isArray(applicationData.relevantExperience)
          ? applicationData.relevantExperience
          : [],
        portfolio: Array.isArray(applicationData.portfolio)
          ? applicationData.portfolio
          : [],
      });

      logger.info(`[ApplicationService.submitApplication] Application created with snapshot`, {
        applicationId: application._id,
        applicantName: applicantProfileSnapshot?.name,
        applicantRating: applicantProfileSnapshot?.rating,
        snapshotData: applicantProfileSnapshot
      });

      // Increment task applications count (atomic operation)
      logger.debug(`[ApplicationService.submitApplication] Incrementing application count for taskId=${taskId}`);
      await Task.updateOne({ _id: taskId }, { $inc: { applications: 1 } });

      logger.info(
        `Application submitted: ${application._id} for task ${taskId} by user ${applicantUid}`
      );

      // EMIT: APPLICATION_SUBMITTED notification to task requester
      try {
        logger.info(`[ApplicationService.submitApplication] Starting profile lookup`, {
          taskRequesterId: task.requesterId,
          requestIdType: typeof task.requesterId,
          isObjectId: task.requesterId instanceof mongoose.Types.ObjectId
        });
        
        // ✅ FIX: Convert requesterId to ObjectId for proper MongoDB query
        let requesterId: any;
        try {
          requesterId = task.requesterId instanceof mongoose.Types.ObjectId 
            ? task.requesterId 
            : new mongoose.Types.ObjectId(task.requesterId);
          
          logger.info(`[ApplicationService.submitApplication] ObjectId conversion successful`, {
            original: task.requesterId,
            converted: requesterId.toString()
          });
        } catch (conversionError) {
          logger.error(`[ApplicationService.submitApplication] ObjectId conversion failed`, {
            original: task.requesterId,
            error: conversionError instanceof Error ? conversionError.message : String(conversionError)
          });
          throw conversionError;
        }
        
        // Try profiles collection
        logger.info(`[ApplicationService.submitApplication] Querying profiles collection`, {
          query: { _id: requesterId.toString() }
        });
        
        const ProfilesCol = mongoose.connection.collection("profiles");
        let requesterProfile = await ProfilesCol.findOne({ _id: requesterId });
        
        if (!requesterProfile) {
          logger.warn(`[ApplicationService.submitApplication] Profile not found in 'profiles' collection, trying 'users'`, {
            requesterId: requesterId.toString()
          });
          
          // Try users collection as fallback
          const UsersCol = mongoose.connection.collection("users");
          requesterProfile = await UsersCol.findOne({ _id: requesterId });
          
          if (requesterProfile) {
            logger.info(`[ApplicationService.submitApplication] Found profile in 'users' collection instead`);
          }
        }
        
        logger.info(`[ApplicationService.submitApplication] APPLICATION EMAIL - Fetched requester profile`, {
          applicationId: application._id,
          requesterId: task.requesterId.toString(),
          hasProfile: !!requesterProfile,
          hasEmail: !!requesterProfile?.email,
          email: requesterProfile?.email?.substring(0, 10) + '***',
          collectionType: requesterProfile ? 'found' : 'not_found',
          profileFields: requesterProfile ? {
            name: requesterProfile.name,
            fullName: requesterProfile.fullName,
            firstName: requesterProfile.firstName,
            lastName: requesterProfile.lastName,
            uid: requesterProfile.uid,
            userId: requesterProfile.userId,
            email: !!requesterProfile.email,
            photoURL: requesterProfile.photoURL ? '✓' : '✗'
          } : 'null'
        });

        if (requesterProfile?.uid) {
          logger.debug(`[ApplicationService.submitApplication] Sending APPLICATION_SUBMITTED notification`);
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

          // Polling in-app notification for task owner (taskUpdates category)
          await InAppNotificationClient.send({
            userId: requesterProfile.uid,
            title: 'New offer on your task',
            body: `${applicantProfileSnapshot?.name || 'A tasker'} applied to "${task.title}"`,
            category: 'taskUpdates',
            type: 'info',
            data: {
              taskId,
              applicationId: application._id.toString(),
              applicantUid,
            },
          });
        }
        
        // Email: application submitted → requester
        if (requesterProfile?.email) {
          logger.info(`[ApplicationService.submitApplication] APPLICATION EMAIL - Starting email workflow`, {
            applicationId: application._id,
            taskId,
            requesterId: task.requesterId,
            requesterEmail: requesterProfile.email?.substring(0, 10) + '***',
            requesterUid: requesterProfile.uid
          });

          try {
            logger.debug(`[ApplicationService.submitApplication] APPLICATION EMAIL - Checking email preferences`);
            const emailEnabled = await NotificationPreferenceChecker.isEmailNotificationEnabled(
              requesterProfile.uid,
              'taskUpdates'
            );
            
            logger.info(`[ApplicationService.submitApplication] APPLICATION EMAIL - Email preference check result`, {
              applicationId: application._id,
              requesterId: requesterProfile.uid,
              emailEnabled,
              category: 'taskUpdates'
            });
            
            if (emailEnabled) {
              logger.info(`[ApplicationService.submitApplication] APPLICATION EMAIL - Email enabled, sending now`);
              const taskUrl = `${config.WEB_APP_URL}/tasks/${taskId}`;
              
              await EmailServiceClient.sendApplicationSubmitted(requesterProfile.email, {
                requesterName: requesterProfile.name || requesterProfile.fullName || 'Task owner',
                applicantName: applicantProfileSnapshot?.name || 'An applicant',
                taskTitle: task.title,
                proposedAmount: application.proposedBudget?.amount,
                applicantMessage: application.coverLetter || undefined,
                applicantRating: applicantProfileSnapshot?.rating,
                applicantCompletedTasks: applicantProfileSnapshot?.totalReviews,
                applicationUrl: taskUrl,
                taskUrl: taskUrl,
                userId: requesterProfile.uid,
              });
              logger.info(`[ApplicationService.submitApplication] APPLICATION EMAIL - Email sent successfully`, {
                applicationId: application._id,
                taskId,
                to: requesterProfile.email?.substring(0, 10) + '***',
                template: 'application_submitted'
              });
            } else {
              logger.warn(`[ApplicationService.submitApplication] APPLICATION EMAIL - Email notifications disabled`, {
                applicationId: application._id,
                requesterId: requesterProfile.uid,
                category: 'taskUpdates'
              });
            }
          } catch (emailErr) {
            logger.error('APPLICATION EMAIL - Error during email send', {
              applicationId: application._id,
              taskId,
              email: requesterProfile.email?.substring(0, 10) + '***',
              error: emailErr instanceof Error ? emailErr.message : 'Unknown error',
              stack: emailErr instanceof Error ? emailErr.stack : undefined
            });
          }
        } else {
          logger.warn(`[ApplicationService.submitApplication] APPLICATION EMAIL - No email in requester profile`, {
            applicationId: application._id,
            requesterId: task.requesterId,
            hasProfile: !!requesterProfile
          });
        }
      } catch (error) {
        logger.error('APPLICATION EMAIL - Error in notification workflow', {
          applicationId: application._id,
          taskId,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        });
      }

      return application;
    } catch (error) {
      logger.error('[ApplicationService.submitApplication] Error creating application:', {
        taskId,
        applicantProfileId: applicantProfileId.toString(),
        applicantUid,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Get applications with authorization checks
   */
  static async getApplications(
    currentUserProfileId: mongoose.Types.ObjectId | undefined,
    filters: {
      taskId?: string;
      mine?: boolean;
      status?: ApplicationStatus;
      limit?: number;
      page?: number;
    }
  ): Promise<{ applications: any[]; pagination: any }> {
    const MAX_PAGE = 100;
    const { taskId, mine, status, limit = 20, page = 1 } = filters;
    const pageSize = Math.min(limit, 100);
    const pageNum = Math.min(Math.max(1, Number(page) || 1), MAX_PAGE);
    const skip = (pageNum - 1) * pageSize;

    const query: any = {};

    // Get applications for a specific task
    if (taskId) {
      const task = await Task.findById(taskId);
      if (!task) {
        throw new NotFoundError("Task not found");
      }

      // ✅ Everyone sees all applications for a task
      // Budget amounts will be hidden at the controller level based on ownership
      query.taskId = taskId;
    }

    // Get my applications across all tasks (requires auth)
    if (mine && currentUserProfileId) {
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
    const needProfileIds = applications
      .filter((app) => !app.applicantProfile?.name)
      .map((app) => app.applicantId);
    const uniqueApplicantIds = [...new Set(needProfileIds.map((id: any) => id.toString()))];

    let profileMap = new Map<string, any>();
    if (uniqueApplicantIds.length > 0) {
      try {
        const profiles = await Profile.find({
          _id: { $in: uniqueApplicantIds.map((id) => new mongoose.Types.ObjectId(id)) },
        }).toArray();
        profileMap = new Map(profiles.map((p: any) => [p._id.toString(), p]));
      } catch (error) {
        logger.warn("Could not batch fetch applicant profiles", { error });
      }
    }

    const enrichedApplications = applications.map((app) => {
      // Always try to get fresh profile data if not already populated
      let applicantProfile = null;
      
      if (app.applicantProfile && app.applicantProfile.name) {
        // Use stored snapshot if available
        applicantProfile = app.applicantProfile;
      } else if (app.applicantId) {
        // Fetch from map
        const profile = profileMap.get(app.applicantId.toString());
        if (profile) {
          applicantProfile = {
            name: profile.name || profile.fullName,
            photoURL: profile.photoURL,
            rating: profile.rating,
            totalReviews: profile.totalReviews,
            skills: profile.skills,
          };
        }
      }
      
      return {
        ...app,
        applicantProfile,
      };
    });

    // Get total count for pagination
    const total = await TaskApplication.countDocuments(query);

    logger.info(`[ApplicationService.getApplications] Applications enrichment complete`, {
      totalApplications: enrichedApplications.length,
      withProfiles: enrichedApplications.filter(a => !!a.applicantProfile?.name).length,
      withoutProfiles: enrichedApplications.filter(a => !a.applicantProfile?.name).length,
      taskId: taskId || 'all'
    });

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
      "requesterId status title budget location scheduledDate scheduledTimeStart scheduledTimeEnd recurring schedule"
    );

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    // Always load full task to ensure recurring schedule is available
    const populatedTask = application.taskId as any;
    const taskId = populatedTask?._id || application.taskId;
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // Only task creator can update application status
    if (!task.requesterId.equals(taskOwnerProfileId)) {
      throw new ForbiddenError("Not authorized to update this application");
    }

    // STEP 1: Get old status for change detection
    const oldStatus = application.status;

    // Validate status transition
    if (status === "accepted") {
      const isRecurring = Boolean(task.recurring?.enabled) && Array.isArray(task.schedule) && task.schedule.length > 0;

      if (!isRecurring && task.status !== "open") {
        throw new BadRequestError("Task is not open for assignment");
      }

      // Get applicant profile to set assigneeUid
      const Profile = mongoose.connection.collection("profiles");
      const applicantProfile = await Profile.findOne({ _id: application.applicantId });

      if (isRecurring && Array.isArray(application.selectedDates) && application.selectedDates.length > 0) {
        const selectedSet = new Set(
          application.selectedDates.map((d: Date) => new Date(d).toDateString())
        );

        let updatedAny = false;
        const schedule = task.schedule as any[];

        schedule.forEach((entry) => {
          const entryKey = new Date(entry.date).toDateString();
          if (selectedSet.has(entryKey)) {
            if (entry.status !== "open") {
              throw new BadRequestError("One or more selected dates are no longer available");
            }
            entry.status = "assigned";
            entry.assigneeId = application.applicantId;
            entry.assigneeUid = applicantProfile?.uid || null;
            updatedAny = true;
          }
        });

        if (!updatedAny) {
          throw new BadRequestError("No matching schedule dates found to assign");
        }

        const hasOpenDates = schedule.some((entry) => entry.status === "open");
        task.status = hasOpenDates ? "open" : "assigned";
        task.updatedAt = new Date();
        task.assignedAt = new Date();

        await task.save();

        logger.info(`✅ Recurring task ${task._id} dates assigned to ${application.applicantId}`);
      } else {
        // Concurrency-safe: only assign if task is still open (prevents two users accepting different applications simultaneously)
        const updatedTask = await Task.findOneAndUpdate(
          { _id: task._id, status: "open" },
          {
            $set: {
              status: "assigned",
              assigneeId: application.applicantId,
              assigneeUid: applicantProfile?.uid || null,
              assignedToName: applicantProfile?.name || applicantProfile?.fullName || "Assigned User",
              assignedAt: new Date(),
              updatedAt: new Date(),
            },
          },
          { new: true }
        );

        if (!updatedTask) {
          throw new ConflictError(
            "Task is no longer open for assignment; another application may have been accepted."
          );
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

        logger.info(`✅ Task ${task._id} assigned to ${application.applicantId}`);
      }
    }

    // STEP 2: Update application status
    application.status = status || application.status;
    application.updatedAt = new Date();
    if (!application.negotiation) {
      application.negotiation = {
        currentAmount: application.proposedBudget.amount,
        status: "none",
        history: [],
      };
    }
    if (application.status === "accepted") {
      application.negotiation.currentAmount = application.proposedBudget.amount;
      application.negotiation.status = "accepted";
      application.negotiation.lastActionBy = "poster";
      application.negotiation.history.push({
        amount: application.proposedBudget.amount,
        action: "accept",
        by: "poster",
        at: new Date(),
      });
    }
    if (application.status === "rejected") {
      application.negotiation.status = "rejected";
      application.negotiation.lastActionBy = "poster";
      application.negotiation.history.push({
        amount: application.proposedBudget.amount,
        action: "reject",
        by: "poster",
        at: new Date(),
      });
    }

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

          // Polling in-app notification to tasker (applicant)
          await InAppNotificationClient.send({
            userId: applicantUid,
            title: 'Offer accepted',
            body: `Your offer for "${task.title}" was accepted. Coordinate and get started!`,
            category: 'taskUpdates',
            type: 'success',
            data: {
              taskId: task._id.toString(),
              applicationId,
              status: 'accepted'
            }
          });
        } catch (error) {
          logger.error('Error sending APPLICATION_ACCEPTED notification', {
            applicationId,
            taskId: task._id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        // Email: application accepted → applicant; task assigned → requester
        const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}/track`;
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

  static async editApplication(
    applicationId: string,
    applicantProfileId: mongoose.Types.ObjectId,
    payload: {
      coverLetter?: string;
      proposedBudget?: {
        amount?: number;
        currency?: string;
      };
    }
  ): Promise<ITaskApplication> {
    const application = await TaskApplication.findById(applicationId);

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    if (!application.applicantId.equals(applicantProfileId)) {
      throw new ForbiddenError("Not authorized to edit this application");
    }

    if (application.status !== "pending") {
      throw new BadRequestError("Only pending offers can be edited");
    }

    let changed = false;

    if (payload.coverLetter !== undefined) {
      application.coverLetter = String(payload.coverLetter).trim();
      changed = true;
    }

    if (payload.proposedBudget !== undefined) {
      const { amount, currency } = payload.proposedBudget;

      if (amount !== undefined) {
        const rawAmount = Number(amount);
        if (!Number.isInteger(rawAmount) || rawAmount <= 0) {
          throw new BadRequestError("Proposed budget amount must be a positive whole number");
        }
        if (rawAmount > 50000) {
          throw new BadRequestError("Proposed budget amount cannot exceed 50000");
        }

        application.proposedBudget.amount = rawAmount;
        if (application.negotiation) {
          application.negotiation.currentAmount = rawAmount;
        }
        changed = true;
      }

      if (currency !== undefined) {
        application.proposedBudget.currency = String(currency).trim() || application.proposedBudget.currency;
        changed = true;
      }
    }

    if (!changed) {
      throw new BadRequestError("No valid fields provided to edit");
    }

    application.updatedAt = new Date();
    await application.save();

    return application;
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

  static async negotiateApplication(
    applicationId: string,
    actorProfileId: mongoose.Types.ObjectId,
    actorUid: string,
    payload: { action: "counter" | "accept" | "reject"; amount?: number }
  ): Promise<ITaskApplication> {
    const application = await TaskApplication.findById(applicationId).populate(
      "taskId",
      "requesterId status title"
    );

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    const task = application.taskId as any;
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    const isPoster = task.requesterId?.equals(actorProfileId);
    const isTasker = application.applicantId.equals(actorProfileId);

    if (!isPoster && !isTasker) {
      throw new ForbiddenError("Not authorized to negotiate this offer");
    }

    if (application.status !== "pending") {
      throw new BadRequestError("Only pending offers can be negotiated");
    }

    if (!application.negotiation) {
      application.negotiation = {
        currentAmount: application.proposedBudget.amount,
        status: "none",
        history: [],
      };
    }

    const actorRole: "poster" | "tasker" = isPoster ? "poster" : "tasker";
    const { action } = payload;

    if (action === "counter") {
      if (application.proposedBudget.isNegotiable === false) {
        throw new BadRequestError("This offer is not negotiable");
      }

      const rawAmount = Number(payload.amount);
      if (!Number.isInteger(rawAmount) || rawAmount <= 0) {
        throw new BadRequestError("Counter amount must be a valid whole number");
      }
      if (rawAmount < 50) {
        throw new BadRequestError("Counter amount must be at least 50");
      }
      if (rawAmount > 50000) {
        throw new BadRequestError("Counter amount cannot exceed 50000");
      }

      application.proposedBudget.amount = rawAmount;
      application.negotiation.currentAmount = rawAmount;
      application.negotiation.status =
        actorRole === "poster" ? "countered_by_poster" : "countered_by_tasker";
      application.negotiation.lastActionBy = actorRole;
      application.negotiation.history.push({
        amount: rawAmount,
        action: "counter",
        by: actorRole,
        at: new Date(),
      });
    } else if (action === "accept") {
      if (
        (actorRole === "tasker" && application.negotiation.status !== "countered_by_poster") ||
        (actorRole === "poster" && application.negotiation.status !== "countered_by_tasker")
      ) {
        throw new BadRequestError("No pending counter offer to accept");
      }

      application.negotiation.status = "accepted";
      application.negotiation.lastActionBy = actorRole;
      application.negotiation.history.push({
        amount: application.negotiation.currentAmount,
        action: "accept",
        by: actorRole,
        at: new Date(),
      });
    } else if (action === "reject") {
      application.status = "rejected";
      application.negotiation.status = "rejected";
      application.negotiation.lastActionBy = actorRole;
      application.negotiation.history.push({
        amount: application.negotiation.currentAmount,
        action: "reject",
        by: actorRole,
        at: new Date(),
      });
    }

    application.updatedAt = new Date();
    await application.save();

    logger.info("Application negotiation updated", {
      applicationId,
      actorUid,
      action,
      amount: application.proposedBudget.amount,
      negotiationStatus: application.negotiation.status,
      applicationStatus: application.status,
    });

    // Polling in-app notification for negotiation updates (price counter / accept / reject)
    try {
      const Profile = mongoose.connection.collection("profiles");
      const posterProfile = await Profile.findOne({ _id: task.requesterId });
      const posterUid =
        posterProfile && typeof posterProfile === "object" && "uid" in posterProfile
          ? (posterProfile as { uid?: unknown }).uid
          : undefined;

      const counterpartyUid =
        actorRole === "poster"
          ? application.applicantUid
          : typeof posterUid === "string"
          ? posterUid
          : undefined;

      if (counterpartyUid) {
        const amount = application.negotiation.currentAmount;
        let title = "Offer update";
        let body = `Offer updated for "${task.title}".`;
        let type: "info" | "warning" | "error" | "success" = "info";

        if (action === "counter") {
          title = "Offer updated";
          body = `A new counter offer of Rs ${amount} was proposed for "${task.title}".`;
          type = "info";
        } else if (action === "accept") {
          title = "Offer accepted";
          body = `Your negotiated offer for "${task.title}" was accepted at Rs ${amount}.`;
          type = "success";
        } else if (action === "reject") {
          title = "Offer rejected";
          body = `The negotiated offer for "${task.title}" was rejected.`;
          type = "warning";
        }

        await InAppNotificationClient.send({
          userId: counterpartyUid,
          title,
          body,
          category: "taskUpdates",
          type,
          data: {
            taskId: task._id.toString(),
            applicationId: application._id.toString(),
            negotiationAction: action,
            negotiationStatus: application.negotiation.status,
            amount,
          },
        });
      }
    } catch (notificationError) {
      logger.warn("Failed to send in-app negotiation update notification", {
        applicationId,
        action,
        error: notificationError instanceof Error ? notificationError.message : "Unknown error",
      });
    }

    return application;
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

    // Use findByIdAndUpdate to avoid Mongoose validation issues with required fields
    await TaskApplication.findByIdAndUpdate(
      applicationId,
      {
        status: "withdrawn",
        updatedAt: new Date(),
      },
      { new: true }
    );

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

    // 1️⃣ Mark application withdrawn using findByIdAndUpdate to avoid validation issues
    await TaskApplication.findByIdAndUpdate(
      applicationId,
      {
        status: "withdrawn",
        updatedAt: new Date(),
      },
      { new: true }
    );

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
