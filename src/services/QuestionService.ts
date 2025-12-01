import TaskQuestion, { ITaskQuestion } from '../models/TaskQuestion';
import Task from '../models/Task';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';
import mongoose from 'mongoose';

export class QuestionService {
  /**
   * Ask a question on a task
   */
  static async askQuestion(
    taskId: string,
    askedByUid: string,
    question: string
  ): Promise<ITaskQuestion> {
    if (!question || question.trim().length === 0) {
      throw new BadRequestError('Question is required');
    }

    if (question.trim().length > 1000) {
      throw new BadRequestError('Question must be 1000 characters or less');
    }

    // Check if task exists
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if user is trying to ask question on their own task
    if (task.requesterId === askedByUid) {
      throw new BadRequestError('Cannot ask questions on your own task');
    }

    // Check if user already asked the same question
    const existingQuestion = await TaskQuestion.findOne({
      taskId,
      askedByUid,
      question: question.trim()
    });

    if (existingQuestion) {
      throw new BadRequestError('You have already asked this question');
    }

    // Create question
    const taskQuestion = await TaskQuestion.create({
      taskId,
      askedByUid,
      question: question.trim(),
      isPublic: true
    });

    // Fetch asker profile for response
    const Profile = mongoose.connection.collection('profiles');
    let askerProfile = null;
    try {
      askerProfile = await Profile.findOne({ uid: askedByUid });
    } catch (error) {
      logger.warn('Could not fetch asker profile for', askedByUid);
    }

    const result = taskQuestion.toObject();
    return {
      ...result,
      askerProfile: askerProfile ? {
        name: askerProfile.name,
        photoURL: askerProfile.photoURL,
        rating: askerProfile.rating,
        totalReviews: askerProfile.totalReviews
      } : null
    } as any;
  }

  /**
   * Get all questions for a task
   */
  static async getTaskQuestions(taskId: string, uid: string): Promise<any[]> {
    // Check if task exists
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Fetch all public questions for this task
    const questions = await TaskQuestion.find({
      taskId,
      isPublic: true
    })
      .sort({ createdAt: -1 })
      .lean();

    // Enrich questions with asker and answerer profiles
    const Profile = mongoose.connection.collection('profiles');
    const enrichedQuestions = await Promise.all(
      questions.map(async (q) => {
        let askerProfile = null;
        let answererProfile = null;

        try {
          askerProfile = await Profile.findOne({ uid: q.askedByUid });
        } catch (error) {
          logger.warn('Could not fetch asker profile for', q.askedByUid);
        }

        if (q.answeredByUid) {
          try {
            answererProfile = await Profile.findOne({ uid: q.answeredByUid });
          } catch (error) {
            logger.warn('Could not fetch answerer profile for', q.answeredByUid);
          }
        }

        return {
          id: String(q._id),
          _id: String(q._id),
          taskId: String(q.taskId),
          askedByUid: q.askedByUid,
          question: q.question,
          answer: q.answer,
          answeredByUid: q.answeredByUid,
          answeredAt: q.answeredAt,
          isPublic: q.isPublic,
          createdAt: q.createdAt,
          updatedAt: q.updatedAt,
          askerProfile: askerProfile ? {
            name: askerProfile.name,
            photoURL: askerProfile.photoURL,
            rating: askerProfile.rating,
            totalReviews: askerProfile.totalReviews
          } : null,
          answererProfile: answererProfile ? {
            name: answererProfile.name,
            photoURL: answererProfile.photoURL
          } : null
        };
      })
    );

    return enrichedQuestions;
  }

  /**
   * Answer a question
   */
  static async answerQuestion(
    taskId: string,
    questionId: string,
    answeredByUid: string,
    answer: string
  ): Promise<ITaskQuestion> {
    if (!answer || answer.trim().length === 0) {
      throw new BadRequestError('Answer is required');
    }

    if (answer.trim().length > 1000) {
      throw new BadRequestError('Answer must be 1000 characters or less');
    }

    // Check if task exists
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Only task creator can answer questions
    if (task.requesterId !== answeredByUid) {
      throw new ForbiddenError('Only task creator can answer questions');
    }

    // Find the question
    const question = await TaskQuestion.findOne({
      _id: questionId,
      taskId
    });

    if (!question) {
      throw new NotFoundError('Question not found');
    }

    // Update question with answer
    question.answer = answer.trim();
    question.answeredByUid = answeredByUid;
    question.answeredAt = new Date();
    question.updatedAt = new Date();
    await question.save();

    // Fetch profiles for response
    const Profile = mongoose.connection.collection('profiles');
    let askerProfile = null;
    let answererProfile = null;

    try {
      askerProfile = await Profile.findOne({ uid: question.askedByUid });
    } catch (error) {
      logger.warn('Could not fetch asker profile for', question.askedByUid);
    }

    try {
      answererProfile = await Profile.findOne({ uid: answeredByUid });
    } catch (error) {
      logger.warn('Could not fetch answerer profile for', answeredByUid);
    }

    const result = question.toObject();
    return {
      ...result,
      askerProfile: askerProfile ? {
        name: askerProfile.name,
        photoURL: askerProfile.photoURL,
        rating: askerProfile.rating,
        totalReviews: askerProfile.totalReviews
      } : null,
      answererProfile: answererProfile ? {
        name: answererProfile.name,
        photoURL: answererProfile.photoURL
      } : null
    } as any;
  }

  /**
   * Delete a question
   */
  static async deleteQuestion(
    taskId: string,
    questionId: string,
    uid: string
  ): Promise<void> {
    // Find the question
    const question = await TaskQuestion.findOne({
      _id: questionId,
      taskId
    });

    if (!question) {
      throw new NotFoundError('Question not found');
    }

    // Check if task exists
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Only question asker or task creator can delete
    const isAsker = question.askedByUid === uid;
    const isTaskCreator = task.requesterId === uid;

    if (!isAsker && !isTaskCreator) {
      throw new ForbiddenError('Not authorized to delete this question');
    }

    await TaskQuestion.deleteOne({ _id: questionId });
    logger.info(`Question deleted: ${questionId} by user ${uid}`);
  }
}



