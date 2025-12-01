import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { QuestionService } from '../services/QuestionService';

export class QuestionController {
  /**
   * POST /api/v1/tasks/:taskId/questions
   * Ask a question
   */
  static async askQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const question = await QuestionService.askQuestion(
      req.params.taskId,
      req.user!.uid,
      req.body.question
    );

    // Old format: return question with id at root
    res.status(201).json({
      id: String(question._id),
      _id: String(question._id),
      taskId: String(question.taskId),
      askedByUid: question.askedByUid,
      question: question.question,
      answer: question.answer,
      answeredByUid: question.answeredByUid,
      answeredAt: question.answeredAt,
      isPublic: question.isPublic,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
      askerProfile: (question as any).askerProfile
    });
  }

  /**
   * GET /api/v1/tasks/:taskId/questions
   * Get all questions for a task
   */
  static async getTaskQuestions(req: AuthenticatedRequest, res: Response): Promise<void> {
    const questions = await QuestionService.getTaskQuestions(
      req.params.taskId,
      req.user!.uid
    );

    // Old format: return { questions: [...], count: ... }
    res.json({
      questions,
      count: questions.length
    });
  }

  /**
   * POST /api/v1/tasks/:taskId/questions/:questionId/answer
   * Answer a question
   */
  static async answerQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const question = await QuestionService.answerQuestion(
      req.params.taskId,
      req.params.questionId,
      req.user!.uid,
      req.body.answer
    );

    // Old format: return question with id at root
    res.json({
      id: String(question._id),
      _id: String(question._id),
      taskId: String(question.taskId),
      askedByUid: question.askedByUid,
      question: question.question,
      answer: question.answer,
      answeredByUid: question.answeredByUid,
      answeredAt: question.answeredAt,
      isPublic: question.isPublic,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
      askerProfile: (question as any).askerProfile,
      answererProfile: (question as any).answererProfile
    });
  }

  /**
   * DELETE /api/v1/tasks/:taskId/questions/:questionId
   * Delete a question
   */
  static async deleteQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
    await QuestionService.deleteQuestion(
      req.params.taskId,
      req.params.questionId,
      req.user!.uid
    );

    // Old format: return message object
    res.json({
      message: 'Question deleted successfully'
    });
  }
}



