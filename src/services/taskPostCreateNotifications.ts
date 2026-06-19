import mongoose from 'mongoose';
import type { ITask } from '../models/Task';
import logger from '../config/logger';
import { NotificationClient } from './NotificationClient';
import { UserMatchingService } from './UserMatchingService';
import { UserServiceClient } from '../clients/UserServiceClient';
import { EmailServiceClient } from '../clients/EmailServiceClient';
import { InAppNotificationClient } from '../clients/InAppNotificationClient';
import { fireWhatsAppNotify } from '../clients/WhatsAppClient';
import { taskOpenAppButton } from '../utils/whatsappTaskButtons';
import { MainAdminNotificationClient } from '../clients/MainAdminNotificationClient';
import { NotificationPreferenceChecker } from './NotificationPreferenceChecker';
import { config } from '../config/env';
import TaskApplication from '../models/TaskApplication';
import {
  excludeTaskPoster,
  resolvePosterUid,
  withHelperAlertData,
} from '../utils/helperNotificationRecipients';

export type PostCreateNotificationContext = {
  uid?: string;
  mappedCategory: string;
  categorySlug: string;
  frontendCategory: string;
};

/** Emails, helper alerts, and ops notifications — runs after HTTP response. */
export async function runPostCreateNotifications(
  task: ITask,
  ctx: PostCreateNotificationContext,
): Promise<void> {
  const { uid, mappedCategory, categorySlug, frontendCategory } = ctx;
    // Verify the created task has the correct requesterId
    logger.info(`[TaskService.postCreateNotifications] Task created with requesterId`, {
      taskId: task._id,
      requesterId: task.requesterId,
      requesterIdType: typeof task.requesterId,
      isObjectId: task.requesterId instanceof mongoose.Types.ObjectId
    });

    // Check if the requester profile actually exists
    try {
      const ProfilesCol = mongoose.connection.collection("profiles");
      const requesterProfile = await ProfilesCol.findOne({ _id: task.requesterId });

      logger.info(`[TaskService.postCreateNotifications] Requester profile lookup`, {
        taskId: task._id,
        requesterId: task.requesterId.toString(),
        profileExists: !!requesterProfile,
        profileName: requesterProfile?.name || requesterProfile?.fullName || 'NOT FOUND'
      });
    } catch (error) {
      logger.warn(`[TaskService.postCreateNotifications] Could not verify requester profile`, {
        taskId: task._id,
        requesterId: task.requesterId.toString(),
        error: error instanceof Error ? error.message : String(error)
      });
    }

    let requesterProfile: Record<string, any> | null = null;
    try {
      const Profile = mongoose.connection.collection("profiles");
      const requesterId = task.requesterId instanceof mongoose.Types.ObjectId
        ? task.requesterId
        : new mongoose.Types.ObjectId(task.requesterId);
      requesterProfile = await Profile.findOne({ _id: requesterId });
    } catch (profileLookupError) {
      logger.warn("[TaskService.postCreateNotifications] Requester profile lookup failed", {
        taskId: task._id,
        requesterId: task.requesterId?.toString?.() ?? task.requesterId,
        error:
          profileLookupError instanceof Error
            ? profileLookupError.message
            : String(profileLookupError),
      });
    }

    try {
      logger.info("[TaskPostedInAppNotification][task-service] Task created â€” triggering ops in-app notification", {
        service: "extrahand-platform-task-service",
        taskId: String(task._id),
        taskTitle: task.title,
        budget: task.budget?.amount,
      });

      await MainAdminNotificationClient.send({
        type: "task_posted",
        taskId: String(task._id),
        taskTitle: task.title,
        userId: requesterProfile?.uid,
        userName: requesterProfile?.name || requesterProfile?.fullName,
        userEmail: requesterProfile?.email,
        userPhone: requesterProfile?.phone,
        occurredAt: new Date().toISOString(),
      });

      logger.info("[TaskPostedInAppNotification][task-service] Ops in-app notification flow completed for task", {
        service: "extrahand-platform-task-service",
        taskId: String(task._id),
        taskTitle: task.title,
      });
    } catch (adminNotifyError) {
      logger.error("[TaskPostedInAppNotification][task-service] Ops in-app notification flow failed for task", {
        service: "extrahand-platform-task-service",
        taskId: String(task._id),
        taskTitle: task.title,
        error:
          adminNotifyError instanceof Error
            ? adminNotifyError.message
            : String(adminNotifyError),
      });
    }

    // Email: task posted confirmation â†’ requester
    try {
      if (requesterProfile?.email) {
        logger.debug(`[TaskService.postCreateNotifications] Sending task_posted_confirmation email to ${requesterProfile.email}`);
        const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
        const emailEnabled = await NotificationPreferenceChecker.isEmailNotificationEnabled(
          requesterProfile.uid,
          'taskUpdates'
        );

        if (emailEnabled) {
          await EmailServiceClient.sendTaskPostedConfirmation(requesterProfile.email, {
            requesterName: requesterProfile.name || requesterProfile.fullName || 'There',
            taskTitle: task.title,
            taskUrl,
            budget: task.budget?.amount,
            category: mappedCategory,
            location: task.location?.city || task.location?.address,
            userId: requesterProfile.uid,
          });
          logger.info(`[TaskService.postCreateNotifications] task_posted_confirmation email sent successfully`, {
            taskId: task._id,
            to: requesterProfile.email,
            userId: requesterProfile.uid
          });
        } else {
          logger.info(`[TaskService.postCreateNotifications] task_posted_confirmation email skipped - preferences disabled`, {
            taskId: task._id,
            userId: requesterProfile.uid,
            category: 'taskUpdates'
          });
        }

        // ðŸ“¬ In-App Notification: task posted confirmation â†’ requester
        try {
          await InAppNotificationClient.send({
            userId: requesterProfile.uid,
            title: 'âœ… Task Posted Successfully',
            body: `Your task "${task.title}" is now visible to taskers`,
            category: 'taskUpdates',
            type: 'success',
            data: {
              taskId: task._id.toString(),
              taskUrl,
              budget: task.budget?.amount
            }
          });
          logger.info(`[TaskService.postCreateNotifications] In-app notification sent to requester`, {
            taskId: task._id,
            userId: requesterProfile.uid
          });
        } catch (inAppError) {
          logger.warn('Failed to send in-app notification to requester', {
            taskId: task._id,
            userId: requesterProfile.uid,
            error: inAppError instanceof Error ? inAppError.message : 'Unknown error'
          });
        }
      } else {
        logger.debug(`[TaskService.postCreateNotifications] No email found for requester profile`, {
          requesterId: task.requesterId
        });
      }
    } catch (error) {
      logger.error("Error sending task_posted_confirmation email", {
        taskId: task._id,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    const posterUid = resolvePosterUid(uid, requesterProfile);

    const skillMatchCategories = Array.from(
      new Set(
        [
          task.subcategory,
          task.categorySlug,
          categorySlug,
          task.categoryLabel,
          task.category,
          frontendCategory,
          mappedCategory,
        ].filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        ),
      ),
    );

    const skillMatchCategory = skillMatchCategories[0];

    let skillMatchedTaskers: string[] = [];
    let nearbyTaskers: string[] = [];

    if (posterUid) {
      try {
        if (skillMatchCategories.length > 0) {
          const skillMatchedUsersRaw = await UserServiceClient.matchSkillCategories(
            skillMatchCategories,
          );
          skillMatchedTaskers = excludeTaskPoster(skillMatchedUsersRaw, posterUid);
        }

        const coords: [number, number] | undefined = task?.location?.coordinates;
        const hasValidCoords =
          Array.isArray(coords) &&
          coords.length === 2 &&
          typeof coords[0] === 'number' &&
          typeof coords[1] === 'number';

        if (hasValidCoords) {
          nearbyTaskers = await UserServiceClient.matchNearbyTaskers({
            longitude: coords[0],
            latitude: coords[1],
            excludeUids: [posterUid],
          });

          // Fallback to direct DB geo match if user-service is unreachable.
          if (nearbyTaskers.length === 0) {
            nearbyTaskers = await UserMatchingService.findNearbyTaskers(
              task,
              undefined,
              [posterUid],
            );
          }
        } else {
          logger.warn('[TaskService.postCreateNotifications] Task missing coordinates for nearby alerts', {
            taskId: task._id,
            coordinates: coords,
          });
        }

        logger.info('[TaskService.postCreateNotifications] Helper discovery recipient lookup', {
          taskId: task._id,
          skillMatchCategories,
          skillMatchedCount: skillMatchedTaskers.length,
          nearbyCount: nearbyTaskers.length,
          hasCoordinates: hasValidCoords,
        });
      } catch (matchErr) {
        logger.warn('[TaskService.postCreateNotifications] Helper alert recipient lookup failed', {
          taskId: task._id,
          error: matchErr instanceof Error ? matchErr.message : 'Unknown error',
        });
      }
    }

    const nearbyTaskerSet = new Set(nearbyTaskers);
    const skillMatchedSet = new Set(skillMatchedTaskers);

    // STEP 1: Emit TASK_CREATED_RECOMMENDED notification
    // Skill-matched helpers who are NOT nearby (nearby helpers get TASK_NEARBY instead).
    if (posterUid) {
      try {
        const recommendedTaskers = skillMatchedTaskers.filter(
          (matchedUid) => !nearbyTaskerSet.has(matchedUid),
        );

        logger.info('[TaskService.postCreateNotifications] CATEGORY_SKILL_ALERTS - Matched users by category only', {
          taskId: task._id,
          skillMatchCategory,
          category: mappedCategory,
          matchedCount: recommendedTaskers.length,
          matchedUsers: recommendedTaskers,
          excludedRequesterUid: posterUid,
        });

        if (recommendedTaskers.length > 0) {
          const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
          const taskRoute = `/tasks/${task._id}`;

          const recommendedLocationLabel =
            task.location?.city ||
            task.location?.address ||
            'your area';

          await NotificationClient.sendBatch(
            {
              eventKey: 'TASK_CREATED_RECOMMENDED',
              category: 'recommendedTaskAlerts',
              actorId: posterUid,
              entity: { type: 'task', id: task._id.toString() },
              title: `New skill matched nearby: ${task.title}`,
              body: `A ${skillMatchCategory} task has been posted near ${recommendedLocationLabel} and matches your skills.`,
              data: withHelperAlertData({
                eventKey: 'TASK_CREATED_RECOMMENDED',
                entityType: 'task',
                skillMatch: true,
                taskId: task._id.toString(),
                category: mappedCategory,
                skillMatchCategory,
                budget: task.budget.amount,
                locationLabel: recommendedLocationLabel,
                taskUrl,
                route: taskRoute,
                actionUrl: taskRoute,
              }, posterUid),
            },
            recommendedTaskers
          );

          // In-app notification must be delivered directly to all matched UIDs.
          for (const matchedUid of recommendedTaskers) {
            try {
              await InAppNotificationClient.send({
                userId: matchedUid,
                title: 'ðŸŽ¯ New Skill Matched Nearby',
                body: `A new "${skillMatchCategory}" task "${task.title}" has been posted near ${recommendedLocationLabel}`,
                category: 'recommendedTaskAlerts',
                type: 'info',
                data: {
                  taskId: task._id.toString(),
                  taskUrl,
                  route: taskRoute,
                  actionUrl: taskRoute,
                  category: mappedCategory,
                  skillMatchCategory,
                  budget: task.budget?.amount,
                  locationLabel: recommendedLocationLabel,
                }
              });
              logger.info('[TaskService.postCreateNotifications] CATEGORY_SKILL_ALERTS - In-app sent (uid-level)', {
                taskId: task._id,
                userId: matchedUid,
                category: mappedCategory,
                route: taskRoute,
              });
            } catch (inAppError) {
              logger.warn('[TaskService.postCreateNotifications] CATEGORY_SKILL_ALERTS - In-app failed (uid-level)', {
                taskId: task._id,
                userId: matchedUid,
                error: inAppError instanceof Error ? inAppError.message : 'Unknown error'
              });
            }
          }

          // Email: task_created_recommended â†’ matched taskers
          try {
            const Profile = mongoose.connection.collection('profiles');

            // âœ… FIX: query profiles by uid (string), not _id (ObjectId)
            const recommendedProfiles = await Profile.find({ uid: { $in: recommendedTaskers } }).toArray();
            const scheduledDateStr = task.scheduledDate ? new Date(task.scheduledDate).toLocaleDateString() : undefined;

            logger.info('[TaskService.postCreateNotifications] CATEGORY_SKILL_ALERTS - Profile lookup for email', {
              taskId: task._id,
              matchedUidCount: recommendedTaskers.length,
              profileCount: recommendedProfiles.length,
            });

            for (const p of recommendedProfiles) {
              if (!p?.uid || p.uid === posterUid) {
                logger.debug('[TaskService.postCreateNotifications] CATEGORY_SKILL_ALERTS - Skipping invalid/owner recipient', {
                  taskId: task._id,
                  uid: p?.uid,
                });
                continue;
              }

              // Email for category-matched recipient (if email exists and preference enabled).
              if (p.email) {
                try {
                  logger.debug(`[TaskService.postCreateNotifications] Sending task_created_recommended email to ${p.email}`);
                  const emailEnabled = await NotificationPreferenceChecker.isEmailNotificationEnabled(
                    p.uid,
                    'recommendedTaskAlerts'
                  );

                  if (emailEnabled) {
                    await EmailServiceClient.sendTaskCreatedRecommended(p.email, {
                      taskerName: p.name || p.fullName || 'There',
                      taskTitle: task.title,
                      skillCategory: mappedCategory,
                      taskDescription: task.description?.substring(0, 200),
                      budget: task.budget?.amount,
                      location: task.location?.city || task.location?.address,
                      scheduledDate: scheduledDateStr,
                      category: mappedCategory,
                      taskUrl,
                      userId: p.uid,
                    });
                    logger.info('[TaskService.postCreateNotifications] CATEGORY_SKILL_ALERTS - Email sent', {
                      taskId: task._id,
                      to: p.email,
                      userId: p.uid,
                      category: mappedCategory,
                    });
                  } else {
                    logger.info('[TaskService.postCreateNotifications] CATEGORY_SKILL_ALERTS - Email skipped by preferences', {
                      taskId: task._id,
                      userId: p.uid,
                      category: 'recommendedTaskAlerts',
                    });
                  }
                } catch (err) {
                  logger.error('Error sending task_created_recommended email to user', {
                    taskId: task._id,
                    email: p.email,
                    userId: p.uid,
                    error: err instanceof Error ? err.message : 'Unknown error',
                    stack: err instanceof Error ? err.stack : undefined
                  });
                }
              } else {
                logger.info('[TaskService.postCreateNotifications] CATEGORY_SKILL_ALERTS - Email skipped (missing email)', {
                  taskId: task._id,
                  userId: p.uid,
                });
              }
            }
          } catch (emailErr) {
            logger.error('Error sending task_created_recommended emails', {
              taskId: task._id,
              error: emailErr instanceof Error ? emailErr.message : 'Unknown error',
              stack: emailErr instanceof Error ? emailErr.stack : undefined
            });
          }
        }
      } catch (error) {
        logger.error('Error sending TASK_CREATED_RECOMMENDED notification', {
          taskId: task._id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // STEP 2: Emit TASK_CREATED_KEYWORD notification
      // Find users who have saved keywords matching this task (ONLY matching category, not title/description)
      try {
        // Extract search keywords from category plus the user-facing title/label.
        // This lets keyword alerts fire even when the skill category does not match.
        const taskKeywords: string[] = [
          task.category?.toLowerCase(),
          task.subcategory?.toLowerCase(),
          task.categoryLabel?.toLowerCase(),
          task.title?.toLowerCase(),
        ]
          .filter((word): word is string => typeof word === 'string' && word.length > 0)
          .flatMap((word) => [
            word,
            word.replace(/\//g, ' '),
            word.replace(/\s+/g, ' ').trim(),
          ])
          .map((word) => word.toLowerCase().trim())
          .filter((word, index, arr) => word.length > 0 && arr.indexOf(word) === index);

        logger.info(`[TaskService.postCreateNotifications] KEYWORD ALERTS - Extracted keywords`, {
          taskId: task._id,
          keywords: taskKeywords,
          keywordCount: taskKeywords.length,
          taskTitle: task.title.substring(0, 50),
          category: task.category,
          categoryLabel: task.categoryLabel
        });

        if (taskKeywords.length > 0) {
          logger.info(`[TaskService.postCreateNotifications] KEYWORD ALERTS - Querying for matched users`, {
            taskId: task._id,
            keywords: taskKeywords
          });

          const keywordMatchedUsersRaw = await UserServiceClient.matchUsers('keywords', {
            keywords: taskKeywords,
          });
          const keywordMatchedUsers = excludeTaskPoster(keywordMatchedUsersRaw, posterUid);

          logger.info('[TaskService.postCreateNotifications] KEYWORD ALERTS - Matched users by keyword only', {
            taskId: task._id,
            keywords: taskKeywords,
            matchedCount: keywordMatchedUsers.length,
            matchedUsers: keywordMatchedUsers,
            excludedRequesterUid: posterUid,
          });

          logger.info(`[TaskService.postCreateNotifications] KEYWORD ALERTS - User matching result`, {
            taskId: task._id,
            matchedUserCount: keywordMatchedUsers.length,
            matchedUsers: keywordMatchedUsers,
            keywords: taskKeywords
          });

          if (keywordMatchedUsers.length > 0) {
            await NotificationClient.sendBatch(
              {
                eventKey: 'TASK_CREATED_KEYWORD',
                category: 'keywordTaskAlerts',
                actorId: posterUid,
                entity: { type: 'task', id: task._id.toString() },
                title: `Alert: Task matches your saved keywords`,
                body: `A new task has been posted with keywords you're interested in: ${taskKeywords.slice(0, 2).join(', ')}`,
                data: {
                  taskId: task._id.toString(),
                  matchedKeywords: taskKeywords.slice(0, 5),
                  posterUid,
                  actorId: posterUid,
                },
              },
              keywordMatchedUsers
            );
            // Email: task_created_keyword â†’ keyword-matched users
            try {
              const Profile = mongoose.connection.collection('profiles');
              const keywordProfiles = await Profile.find({ uid: { $in: keywordMatchedUsers } }).toArray();

              logger.info(`[TaskService.postCreateNotifications] KEYWORD ALERTS - Fetched profiles`, {
                taskId: task._id,
                fetchedProfileCount: keywordProfiles.length,
                profilesWithEmail: keywordProfiles.filter(p => p.email).length
              });

              const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
              const taskRoute = `/tasks/${task._id}`;
              const scheduledDateStr = task.scheduledDate ? new Date(task.scheduledDate).toLocaleDateString() : undefined;
              const matchedKeywordStr = taskKeywords.slice(0, 2).join(', ');

              for (const p of keywordProfiles) {
                // Skip the task creator - they should not receive alerts for their own tasks
                if (p.uid === posterUid) {
                  logger.info(`[TaskService.postCreateNotifications] KEYWORD ALERTS - Skipping task creator`, {
                    taskId: task._id,
                    creatorId: posterUid
                  });
                  continue;
                }

                logger.debug(`[TaskService.postCreateNotifications] KEYWORD ALERTS - Processing profile`, {
                  taskId: task._id,
                  uid: p.uid,
                  name: p.name,
                  hasEmail: !!p.email,
                  email: p.email?.substring(0, 10) + '***' // Mask email for logs
                });

                if (p.email) {
                  try {
                    logger.debug(`[TaskService.postCreateNotifications] KEYWORD ALERTS - Checking email preference`);
                    // Check if user has enabled keyword alert emails
                    const emailEnabled = await NotificationPreferenceChecker.isEmailNotificationEnabled(
                      p.uid,
                      'keywordTaskAlerts'
                    );

                    logger.info(`[TaskService.postCreateNotifications] KEYWORD ALERTS - Email preference check result`, {
                      taskId: task._id,
                      userId: p.uid,
                      emailEnabled,
                      email: p.email?.substring(0, 10) + '***'
                    });

                    if (emailEnabled) {
                      logger.info(`[TaskService.postCreateNotifications] KEYWORD ALERTS - Sending email`);
                      await EmailServiceClient.sendTaskCreatedKeyword(p.email, {
                        userName: p.name || p.fullName || 'There',
                        taskTitle: task.title,
                        matchedKeyword: matchedKeywordStr,
                        taskDescription: task.description?.substring(0, 200),
                        budget: task.budget?.amount,
                        location: task.location?.city || task.location?.address,
                        scheduledDate: scheduledDateStr,
                        taskUrl,
                        userId: p.uid,
                      });
                      logger.info(`[TaskService.postCreateNotifications] KEYWORD ALERTS - Email sent successfully`, {
                        taskId: task._id,
                        to: p.email?.substring(0, 10) + '***',
                        userId: p.uid,
                        keywords: taskKeywords.slice(0, 3)
                      });

                      // ðŸ“¬ In-App Notification: keyword alert â†’ user
                      try {
                        await InAppNotificationClient.send({
                          userId: p.uid,
                          title: 'ðŸ”” Task Found: ' + matchedKeywordStr,
                          body: `A new task "${task.title}" matches your keywords`,
                          category: 'keywordTaskAlerts',
                          type: 'info',
                          data: {
                            taskId: task._id.toString(),
                            taskUrl,
                            route: taskRoute,
                            actionUrl: taskRoute,
                            keywords: taskKeywords,
                            matchedKeyword: matchedKeywordStr,
                            budget: task.budget?.amount
                          }
                        });
                        logger.info(`[TaskService.postCreateNotifications] KEYWORD ALERTS - In-app notification sent`, {
                          taskId: task._id,
                          userId: p.uid,
                          keywords: taskKeywords.slice(0, 3)
                        });
                      } catch (inAppError) {
                        logger.warn('Failed to send in-app notification for keyword alert', {
                          taskId: task._id,
                          userId: p.uid,
                          error: inAppError instanceof Error ? inAppError.message : 'Unknown error'
                        });
                      }
                    } else {
                      logger.warn(`[TaskService.postCreateNotifications] KEYWORD ALERTS - Email notifications disabled for user`, {
                        taskId: task._id,
                        userId: p.uid,
                        category: 'keywordTaskAlerts'
                      });
                    }
                  } catch (err) {
                    logger.error('Error sending task_created_keyword email to user', {
                      taskId: task._id,
                      email: p.email?.substring(0, 10) + '***',
                      userId: p.uid,
                      error: err instanceof Error ? err.message : 'Unknown error',
                      stack: err instanceof Error ? err.stack : undefined
                    });
                  }
                } else {
                  logger.warn(`[TaskService.postCreateNotifications] KEYWORD ALERTS - Profile has no email`, {
                    taskId: task._id,
                    userId: p.uid,
                    name: p.name
                  });
                }
              }
            } catch (emailErr) {
              logger.error('Error sending task_created_keyword emails', {
                taskId: task._id,
                error: emailErr instanceof Error ? emailErr.message : 'Unknown error',
                stack: emailErr instanceof Error ? emailErr.stack : undefined
              });
            }
          } else {
            logger.warn(`[TaskService.postCreateNotifications] KEYWORD ALERTS - No matched users found`, {
              taskId: task._id,
              keywords: taskKeywords
            });
          }
        } else {
          logger.warn(`[TaskService.postCreateNotifications] KEYWORD ALERTS - No keywords extracted`, {
            taskId: task._id,
            taskTitle: task.title
          });
        }
      } catch (error) {
        logger.error('Error sending TASK_CREATED_KEYWORD notification', {
          taskId: task._id,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        });
      }

      // STEP 3: Emit TASK_CREATED_CATEGORY notification
      // Find users who have saved category matching this task
      try {
        // Create category slugs based on task category
        // Map simple backend categories to content-admin style slugs
        const categorySlugs = [
          task.categorySlug,
          task.category,
          task.subcategory,
        ]
          .map((slug) => (slug ? slug.toString().toLowerCase().trim() : ""))
          .filter((slug) => slug.length > 0);

        if (categorySlugs.length > 0) {
          const categoryMatchedUsers: string[] = [];

          logger.info('[TaskService.postCreateNotifications] CATEGORY_SKILL_ALERTS - Category-slug pipeline remains disabled', {
            taskId: task._id,
            categorySlugs,
          });

          if (categoryMatchedUsers.length > 0) {
            await NotificationClient.sendBatch(
              {
                eventKey: 'TASK_CREATED_CATEGORY',
                category: 'keywordTaskAlerts', // Using same category preference
                actorId: posterUid,
                entity: { type: 'task', id: task._id.toString() },
                title: `New ${task.categoryLabel || task.category} task posted!`,
                body: `A new ${task.categoryLabel || task.category} task has been posted: ${task.title.substring(0, 50)}${task.title.length > 50 ? '...' : ''}`,
                data: withHelperAlertData({
                  taskId: task._id.toString(),
                  category: task.categoryLabel || task.category,
                }, posterUid),
              },
              categoryMatchedUsers
            );

            // Email: task_created_category â†’ category-matched users
            try {
              const Profile = mongoose.connection.collection('profiles');
              const categoryProfiles = await Profile.find({ uid: { $in: categoryMatchedUsers } }).toArray();
              const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
              const scheduledDateStr = task.scheduledDate ? new Date(task.scheduledDate).toLocaleDateString() : undefined;
              const categoryLabel = task.categoryLabel || task.subcategory || task.category;

              for (const p of categoryProfiles) {
                if (p.email) {
                  try {
                    logger.debug(`[TaskService.postCreateNotifications] Sending task_created_category email to ${p.email}`);
                    // Check if user has enabled keyword alert emails
                    const emailEnabled = await NotificationPreferenceChecker.isEmailNotificationEnabled(
                      p.uid,
                      'keywordTaskAlerts'
                    );

                    if (emailEnabled) {
                      await EmailServiceClient.sendTaskCreatedKeyword(p.email, {
                        userName: p.name || p.fullName || 'There',
                        taskTitle: task.title,
                        matchedKeyword: categoryLabel,
                        taskDescription: task.description?.substring(0, 200),
                        budget: task.budget?.amount,
                        location: task.location?.city || task.location?.address,
                        scheduledDate: scheduledDateStr,
                        taskUrl,
                        userId: p.uid,
                      });
                      logger.info(`[TaskService.postCreateNotifications] task_created_category email sent successfully`, {
                        taskId: task._id,
                        to: p.email,
                        userId: p.uid,
                        category: categoryLabel
                      });
                    } else {
                      logger.info(`[TaskService.postCreateNotifications] Email notifications disabled for keyword alerts`, {
                        userId: p.uid
                      });
                    }
                  } catch (err) {
                    logger.error('Error sending task_created_category email to user', {
                      taskId: task._id,
                      email: p.email,
                      userId: p.uid,
                      error: err instanceof Error ? err.message : 'Unknown error',
                      stack: err instanceof Error ? err.stack : undefined
                    });
                  }
                }
              }
            } catch (emailErr) {
              logger.error('Error sending task_created_category emails', {
                taskId: task._id,
                error: emailErr instanceof Error ? emailErr.message : 'Unknown error',
                stack: emailErr instanceof Error ? emailErr.stack : undefined
              });
            }
          }
        }
      } catch (error) {
        logger.error('Error sending TASK_CREATED_CATEGORY notification', {
          taskId: task._id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } else {
      logger.warn('Skipping helper discovery notifications - poster uid not resolved', {
        taskId: task._id,
        requesterId: task.requesterId?.toString?.() ?? task.requesterId,
      });
    }

    // STEP 4: Emit TASK_NEARBY notification
    // One alert per nearby helper (skill wording when applicable).
    try {
      if (nearbyTaskers.length > 0) {
        const taskUrl = `${config.WEB_APP_URL}/tasks/${task._id}`;
        const taskRoute = `/tasks/${task._id}`;
        const locationLabel =
          task.location?.city ||
          task.location?.address ||
          'your area';

        const nearbyAndSkill = excludeTaskPoster(
          nearbyTaskers.filter((u) => skillMatchedSet.has(u)),
          posterUid,
        );
        const nearbyOnly = excludeTaskPoster(
          nearbyTaskers.filter((u) => !skillMatchedSet.has(u)),
          posterUid,
        );

        if (nearbyAndSkill.length > 0) {
          await NotificationClient.sendBatch(
            {
              eventKey: 'TASK_NEARBY',
              category: 'recommendedTaskAlerts',
              actorId: posterUid,
              entity: { type: 'task', id: task._id.toString() },
              title: `Matched your skills nearby: ${task.title}`,
              body: `A ${task.categoryLabel || task.category} task has been posted near ${locationLabel} and matches your skills.`,
              data: withHelperAlertData({
                eventKey: 'TASK_NEARBY',
                entityType: 'task',
                skillMatch: true,
                taskId: task._id.toString(),
                category: task.category,
                categoryLabel: task.categoryLabel || task.category,
                budget: task.budget?.amount,
                locationLabel,
                skillMatchCategory: skillMatchCategory || task.categoryLabel || task.category,
                taskUrl,
                route: taskRoute,
                actionUrl: taskRoute,
              }, posterUid),
            },
            nearbyAndSkill,
          );
        }

        if (nearbyOnly.length > 0) {
          await NotificationClient.sendBatch(
            {
              eventKey: 'TASK_NEARBY',
              category: 'recommendedTaskAlerts',
              actorId: posterUid,
              entity: { type: 'task', id: task._id.toString() },
              title: `New task nearby: ${task.title}`,
              body: `A ${task.categoryLabel || task.category} task has been posted near ${locationLabel}.`,
              data: withHelperAlertData({
                eventKey: 'TASK_NEARBY',
                entityType: 'task',
                skillMatch: false,
                taskId: task._id.toString(),
                category: task.category,
                categoryLabel: task.categoryLabel || task.category,
                budget: task.budget?.amount,
                locationLabel,
                taskUrl,
                route: taskRoute,
                actionUrl: taskRoute,
              }, posterUid),
            },
            nearbyOnly,
          );
        }

        // In-app + WhatsApp for skill-matched nearby helpers
        for (const nearbyUid of excludeTaskPoster(nearbyTaskers, posterUid)) {
          try {
            const isNearbyAndSkill = skillMatchedSet.has(nearbyUid);
            if (isNearbyAndSkill) {
              // Governance: one WA per work+helper; skip if already applied.
              const alreadyApplied = await TaskApplication.exists({
                taskId: task._id,
                applicantUid: nearbyUid,
                status: { $in: ['pending', 'accepted'] },
              });
              if (alreadyApplied) continue;

              const categoryLabel =
                skillMatchCategory || task.categoryLabel || task.category || 'work';
              fireWhatsAppNotify({
                uid: nearbyUid,
                templateKey: 'wa_nearby_work_skill_match',
                category: 'recommendedTaskAlerts',
                templateBody: {
                  var_1: task.title || 'New work',
                  var_2: String(categoryLabel),
                  var_3: String(locationLabel),
                },
                templateButtons: taskOpenAppButton(task._id.toString()),
                idempotencyKey: `wa_nearby_work_skill_match:${task._id.toString()}:${nearbyUid}`,
                metadata: {
                  workId: task._id.toString(),
                  triggerType: 'skill_nearby',
                  recipientRole: 'helper',
                },
              });
            }
            await InAppNotificationClient.send({
              userId: nearbyUid,
              title: isNearbyAndSkill ? 'ðŸŽ¯ New Skill Matched Nearby' : 'ðŸ“ New Task Near You',
              body: isNearbyAndSkill
                ? `A ${task.categoryLabel || task.category} task "${task.title}" matches your skills near ${locationLabel}`
                : `"${task.title}" has been posted near ${locationLabel}`,
              category: 'recommendedTaskAlerts',
              type: 'info',
              data: withHelperAlertData({
                eventKey: 'TASK_NEARBY',
                entityType: 'task',
                skillMatch: isNearbyAndSkill,
                taskId: task._id.toString(),
                taskUrl,
                route: taskRoute,
                actionUrl: taskRoute,
                category: task.category,
                categoryLabel: task.categoryLabel || task.category,
                budget: task.budget?.amount,
                locationLabel,
                skillMatchCategory: skillMatchCategory || task.categoryLabel || task.category,
              }, posterUid),
            });
          } catch (inAppError) {
            logger.warn('[TaskService.postCreateNotifications] NEARBY_ALERTS - In-app failed', {
              taskId: task._id,
              userId: nearbyUid,
              error: inAppError instanceof Error ? inAppError.message : 'Unknown error',
            });
          }
        }

        logger.info('[TaskService.postCreateNotifications] NEARBY_ALERTS - Notifications sent', {
          taskId: task._id,
          nearbyCount: nearbyTaskers.length,
          nearbyAndSkillCount: nearbyAndSkill.length,
          nearbyOnlyCount: nearbyOnly.length,
          locationLabel,
        });
      } else {
        logger.info('[TaskService.postCreateNotifications] NEARBY_ALERTS - No nearby taskers found', {
          taskId: task._id,
          hasCoordinates: !!(task.location?.coordinates),
        });
      }
    } catch (error) {
      logger.error('Error sending TASK_NEARBY notification', {
        taskId: task._id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
}

/** Fire-and-forget wrapper so createTask returns immediately after DB write. */
export function schedulePostCreateNotifications(
  task: ITask,
  ctx: PostCreateNotificationContext,
): void {
  setImmediate(() => {
    void runPostCreateNotifications(task, ctx).catch((error) => {
      logger.error('[TaskService.postCreateNotifications] Unhandled error', {
        taskId: task._id?.toString?.() ?? task._id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });
  });
}
