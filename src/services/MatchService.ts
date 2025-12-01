import Task from '../models/Task';
import { NotFoundError } from '../errors/AppError';
import logger from '../config/logger';
import mongoose from 'mongoose';

// Haversine distance calculation (in km)
function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export class MatchService {
  /**
   * Get candidate matches for a task
   */
  static async getTaskCandidates(
    taskId: string,
    lat?: number,
    lng?: number,
    radiusKm?: number
  ): Promise<any[]> {
    const task = await Task.findById(taskId).lean();
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const skills = Array.isArray(task.requirements) ? task.requirements : [];

    // Get all tasker profiles
    const Profile = mongoose.connection.collection('profiles');
    const candidates = await Profile.find({ roles: { $in: ['tasker'] } })
      .project({ uid: 1, name: 1, photoURL: 1, location: 1, skills: 1 })
      .limit(200)
      .toArray();

    // Use provided lat/lng or task location
    const lt = lat || (task.location?.coordinates?.[1] || 0);
    const ln = lng || (task.location?.coordinates?.[0] || 0);
    const r = radiusKm || 50;

    // Score candidates based on skills and distance
    const scored = candidates
      .filter((p: any) => p.location && typeof p.location.lat === 'number' && typeof p.location.lng === 'number')
      .map((p: any) => {
        const distanceKm = haversineDistanceKm(lt, ln, p.location.lat, p.location.lng);
        const skillOverlap = (p.skills || []).filter((s: string) => skills.includes(s)).length;
        const score = skillOverlap * 10 + Math.max(0, 50 - distanceKm);
        return {
          uid: p.uid,
          name: p.name,
          photoURL: p.photoURL,
          distanceKm,
          skillOverlap,
          score
        };
      })
      .filter((c: any) => c.distanceKm <= r)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 50);

    return scored;
  }
}



