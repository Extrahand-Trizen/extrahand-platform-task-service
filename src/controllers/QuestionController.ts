import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { QuestionService } from '../services/QuestionService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../errors/AppError';
import { containsPhoneNumber, PHONE_NUMBER_ERROR } from '../utils/phoneDetection';
import mongoose from 'mongoose';

export class QuestionController {
  /**
   * POST /api/v1/tasks/:taskId/questions
   * Ask a question
   */
  static async askQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const questionText: string = req.body.question;
    if (containsPhoneNumber(questionText)) {
      throw new BadRequestError(PHONE_NUMBER_ERROR);
    }

    const question = await QuestionService.askQuestion(
      req.params.taskId,
      new mongoose.Types.ObjectId(req.user!.profileId),
      req.user!.uid,
      req.body.question
    );

    ApiResponse.created(res, question, 'Question submitted successfully');
  }

  /**
   * GET /api/v1/tasks/:taskId/questions
   * Get all questions for a task
   */
  static async getTaskQuestions(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const questions = await QuestionService.getTaskQuestions(
      req.params.taskId,
      new mongoose.Types.ObjectId(req.user!.profileId),
      req.user!.uid
    );

    ApiResponse.success(res, questions, 'Questions retrieved successfully');
  }

  /**
   * POST /api/v1/tasks/:taskId/questions/:questionId/answer
   * Answer a question
   */
  static async answerQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    const answerText: string = req.body.answer;
    if (containsPhoneNumber(answerText)) {
      throw new BadRequestError(PHONE_NUMBER_ERROR);
    }

    const question = await QuestionService.answerQuestion(
      req.params.taskId,
      req.params.questionId,
      req.user!.profileId,
      req.body.answer
    );

    ApiResponse.success(res, question, 'Question answered successfully');
  }

  /**
   * DELETE /api/v1/tasks/:taskId/questions/:questionId
   * Delete a question
   */
  static async deleteQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user!.profileId) {
      throw new BadRequestError('Profile not found. Please complete onboarding.');
    }

    await QuestionService.deleteQuestion(
      req.params.taskId,
      req.params.questionId,
      req.user!.profileId,
      req.user!.uid
    );

    ApiResponse.success(res, null, 'Question deleted successfully');
  }
}



