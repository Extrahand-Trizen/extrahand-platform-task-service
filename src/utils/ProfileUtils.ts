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
export interface ApplicantProfileSnapshot {
  name?: string;
  photoURL?: string;
  rating?: number;
  totalReviews?: number;
  skills?: { list: string[] };
}

export class ProfileUtils {
  private static get collection() {
    return mongoose.connection.collection("profiles");
  }

  static isPlaceholderProfileName(name: unknown): boolean {
    const normalized = String(name ?? "").trim().toLowerCase();
    return (
      !normalized ||
      normalized === "user" ||
      normalized === "anonymous" ||
      normalized === "anonymous applicant" ||
      normalized === "user not found" ||
      normalized === "verified user" ||
      normalized === "there" ||
      normalized === "helper" ||
      normalized === "applicant"
    );
  }

  /** Best display name from a raw profile document. */
  static resolveProfileDisplayName(profile: any): string | undefined {
    if (!profile) return undefined;

    const first = String(profile.firstName || "").trim();
    const last = String(profile.lastName || "").trim();
    const combined = `${first} ${last}`.trim();

    const candidates = [
      profile.name,
      profile.fullName,
      profile.displayName,
      combined,
      profile.profession,
    ];

    for (const candidate of candidates) {
      const value = String(candidate || "").trim();
      if (value && !ProfileUtils.isPlaceholderProfileName(value)) {
        return value;
      }
    }

    return undefined;
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
   * Resolve a task assignee's Firebase UID from profile id and/or denormalized task field.
   */
  static async resolveAssigneeFirebaseUid(task: {
    assigneeId?: mongoose.Types.ObjectId | string | null;
    assigneeUid?: string | null;
  }): Promise<string | undefined> {
    if (task.assigneeId) {
      const fromProfile = await ProfileUtils.getUidByProfileId(task.assigneeId);
      if (fromProfile) return fromProfile;
    }
    const fromTask = String(task.assigneeUid || "").trim();
    return fromTask || undefined;
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
   * Normalize profile skills into TaskApplication snapshot shape: { list: string[] }.
   * Handles object skills, stringified JSON arrays, and legacy string entries.
   */
  static normalizeApplicantProfileSkills(
    rawSkills: unknown,
  ): { list: string[] } | undefined {
    if (rawSkills == null) return undefined;

    let listRaw: unknown = rawSkills;
    if (typeof rawSkills === "object" && !Array.isArray(rawSkills) && "list" in rawSkills) {
      listRaw = (rawSkills as { list?: unknown }).list;
    }

    if (typeof listRaw === "string") {
      const trimmed = listRaw.trim();
      if (!trimmed) return undefined;
      if (trimmed.startsWith("[")) {
        try {
          listRaw = JSON.parse(trimmed);
        } catch {
          return { list: [trimmed] };
        }
      } else {
        return { list: [trimmed] };
      }
    }

    if (!Array.isArray(listRaw)) return undefined;

    const names: string[] = [];
    for (const item of listRaw) {
      if (typeof item === "string" && item.trim()) {
        names.push(item.trim());
        continue;
      }
      if (item && typeof item === "object") {
        const name = String((item as { name?: string }).name || "").trim();
        if (name) names.push(name);
      }
    }

    return names.length > 0 ? { list: [...new Set(names)] } : undefined;
  }

  /**
   * Build a normalized applicant profile snapshot from a raw profile document.
   * Used when creating or refreshing the applicantProfile snapshot on an application.
   */
  static buildSnapshot(profile: any): ApplicantProfileSnapshot | undefined {
    if (!profile) return undefined;
    const skills = ProfileUtils.normalizeApplicantProfileSkills(profile.skills);
    const snapshot: ApplicantProfileSnapshot = {
      name: ProfileUtils.resolveProfileDisplayName(profile),
      photoURL: profile.photoURL,
      rating: profile.rating,
      totalReviews: profile.totalReviews,
    };
    if (skills) {
      snapshot.skills = skills;
    }
    return snapshot;
  }
}
