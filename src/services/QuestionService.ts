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
    askedById: mongoose.Types.ObjectId,
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
    if (task.requesterId.equals(askedById)) {
      throw new BadRequestError('Cannot ask questions on your own task');
    }

    //@ts-ignore
    // Create question
    const taskQuestion = await TaskQuestion.create({
      taskId,
      askedById,
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
  static async getTaskQuestions(taskId: string, _profileId: mongoose.Types.ObjectId, _uid: string): Promise<any[]> {
    // Check if task exists
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Fetch all public questions for this task (capped for M0 safety)
    const questions = await TaskQuestion.find({
      taskId,
      isPublic: true
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    // Batch fetch asker and answerer profiles (avoid N+1)
    const Profile = mongoose.connection.collection('profiles');
    const askerIds = [...new Set(questions.map((q: any) => q.askedById).filter(Boolean))];
    const answererIds = [...new Set(questions.map((q: any) => q.answeredById).filter(Boolean))];

    const [askerProfiles, answererProfiles] = await Promise.all([
      askerIds.length > 0 ? Profile.find({ _id: { $in: askerIds } }).toArray() : [],
      answererIds.length > 0 ? Profile.find({ _id: { $in: answererIds } }).toArray() : []
    ]);

    const askerMap = new Map(askerProfiles.map((p: any) => [p._id.toString(), p]));
    const answererMap = new Map(answererProfiles.map((p: any) => [p._id.toString(), p]));

    const enrichedQuestions = questions.map((q: any) => {
      const askerProfile = q.askedById ? askerMap.get(q.askedById.toString()) : null;
      const answererProfile = q.answeredById ? answererMap.get(q.answeredById.toString()) : null;
      return {
        id: String(q._id),
        _id: String(q._id),
        taskId: String(q.taskId),
        askedById: String(q.askedById),
        question: q.question,
        answer: q.answer,
        answeredById: q.answeredById ? String(q.answeredById) : null,
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
    });

    return enrichedQuestions;
  }

  /**
   * Answer a question
   */
  static async answerQuestion(
    taskId: string,
    questionId: string,
    answeredById: mongoose.Types.ObjectId,
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
    if (!task.requesterId.equals(answeredById)) {
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
    //@ts-ignore
    question.answer = answer.trim();
    //@ts-ignore
    question.answeredById = answeredById;
    //@ts-ignore
    question.answeredAt = new Date();
    //@ts-ignore
    question.updatedAt = new Date();
    await question.save();

    // Fetch profiles for response using _id
    const Profile = mongoose.connection.collection('profiles');
    let askerProfile = null;
    let answererProfile = null;

    try {
      //@ts-ignore
      askerProfile = await Profile.findOne({ _id: question.askedById });
    } catch (error) {
      //@ts-ignore
      logger.warn('Could not fetch asker profile for', question.askedById);
    }

    try {
      answererProfile = await Profile.findOne({ _id: answeredById });
    } catch (error) {
      logger.warn('Could not fetch answerer profile for', answeredById);
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
    profileId: mongoose.Types.ObjectId,
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
    //@ts-ignore
    const isAsker = question.askedById.equals(profileId);
    const isTaskCreator = task.requesterId.equals(profileId);

    if (!isAsker && !isTaskCreator) {
      throw new ForbiddenError('Not authorized to delete this question');
    }

    await TaskQuestion.deleteOne({ _id: questionId });
    logger.info(`Question deleted: ${questionId} by user ${uid}`);
  }
}



