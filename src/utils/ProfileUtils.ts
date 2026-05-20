import mongoose from "mongoose";
import logger from "../config/logger";

/**
 * ProfileUtils
 *
 * Centralizes all raw MongoDB "profiles" collection lookups.
 * Replaces the ~8 scattered `mongoose.connection.collection('profiles').findOne(...)`
 * calls that were duplicated across ApplicationService, CompletionService, etc.
 *
 * NOTE: These are raw collection queries (not Mongoose model queries) because
 * the profiles collection belongs to the user-service, not this service.
 * We access it directly via the shared MongoDB connection only for reads.
 */
export class ProfileUtils {
  private static get collection() {
    return mongoose.connection.collection("profiles");
  }

  /**
   * Fetch a profile by its MongoDB ObjectId.
   * @param fields Space-separated list of fields to project (e.g. "uid name email")
   */
  static async getByProfileId(
    profileId: mongoose.Types.ObjectId | string,
    fields?: string
  ): Promise<any | null> {
    try {
      const _id =
        profileId instanceof mongoose.Types.ObjectId
          ? profileId
          : new mongoose.Types.ObjectId(String(profileId));

      const projection = fields
        ? Object.fromEntries(fields.split(" ").map((f) => [f, 1]))
        : undefined;

      return await ProfileUtils.collection.findOne({ _id }, { projection });
    } catch (error) {
      logger.warn("[ProfileUtils.getByProfileId] Failed", {
        profileId: String(profileId),
        error: error instanceof Error ? error.message : "Unknown",
      });
      return null;
    }
  }

  /**
   * Fetch only the Firebase UID for a given profile ObjectId.
   * Minimal projection — returns only the uid string or undefined.
   */
  static async getUidByProfileId(
    profileId: mongoose.Types.ObjectId | string
  ): Promise<string | undefined> {
    const profile = await ProfileUtils.getByProfileId(profileId, "uid");
    return profile?.uid as string | undefined;
  }

  /**
   * Look up profile Mongo ObjectId by auth uid (Firebase uid or dev dummy uid stored on profile).
   */
  static async getProfileIdByUid(
    uid: string
  ): Promise<mongoose.Types.ObjectId | null> {
    const trimmed = String(uid || "").trim();
    if (!trimmed) return null;
    try {
      const doc = await ProfileUtils.collection.findOne(
        { uid: trimmed },
        { projection: { _id: 1 } }
      );
      if (doc?._id) {
        return doc._id instanceof mongoose.Types.ObjectId
          ? doc._id
          : new mongoose.Types.ObjectId(String(doc._id));
      }
    } catch (error) {
      logger.warn("[ProfileUtils.getProfileIdByUid] Failed", {
        uid: trimmed,
        error: error instanceof Error ? error.message : "Unknown",
      });
    }
    return null;
  }

  /**
   * Batch fetch profiles by an array of ObjectIds.
   * Returns a Map keyed by profileId.toString() → profile document.
   * Minimizes round trips for enrichment operations.
   */
  static async getBatchByIds(
    profileIds: (mongoose.Types.ObjectId | string)[]
  ): Promise<Map<string, any>> {
    if (profileIds.length === 0) return new Map();

    try {
      const objectIds = profileIds.map((id) =>
        id instanceof mongoose.Types.ObjectId
          ? id
          : new mongoose.Types.ObjectId(String(id))
      );

      const profiles = await ProfileUtils.collection
        .find({ _id: { $in: objectIds } })
        .project({
          _id: 1,
          name: 1,
          fullName: 1,
          photoURL: 1,
          rating: 1,
          totalReviews: 1,
          skills: 1,
          uid: 1,
          email: 1,
        })
        .toArray();

      return new Map(profiles.map((p: any) => [p._id.toString(), p]));
    } catch (error) {
      logger.warn("[ProfileUtils.getBatchByIds] Failed", {
        count: profileIds.length,
        error: error instanceof Error ? error.message : "Unknown",
      });
      return new Map();
    }
  }

  /**
   * Build a normalized applicant profile snapshot from a raw profile document.
   * Used when creating or refreshing the applicantProfile snapshot on an application.
   */
  static buildSnapshot(profile: any): object | undefined {
    if (!profile) return undefined;
    return {
      name: profile.name || profile.fullName,
      photoURL: profile.photoURL,
      rating: profile.rating,
      totalReviews: profile.totalReviews,
      skills: profile.skills,
    };
  }
}
