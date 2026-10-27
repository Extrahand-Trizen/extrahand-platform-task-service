import AppBanner, { IAppBanner, BannerPlacement } from '../models/AppBanner';
import { NotFoundError, BadRequestError } from '../errors/AppError';

export interface ListBannersParams {
  placement?: BannerPlacement;
  activeOnly?: boolean;
}

export interface CreateBannerInput {
  placement: BannerPlacement;
  tag?: string;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  actionType: 'screen' | 'category' | 'url' | 'tab' | 'none';
  actionValue?: string;
  actionParams?: Record<string, any>;
  backgroundColor?: string;
  tone?: 'light' | 'dark';
  ctaLabel?: string;
  sortOrder?: number;
  isActive?: boolean;
  startDate?: Date;
  endDate?: Date;
}

export class BannerService {
  static async listBanners(params: ListBannersParams): Promise<IAppBanner[]> {
    const query: any = {};
    if (params.placement) {
      query.placement = params.placement.toLowerCase();
    }
    if (params.activeOnly) {
      query.isActive = true;
      const now = new Date();
      query.$and = [
        { $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: now } }] },
      ];
    }

    const banners = await AppBanner.find(query)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    // If activeOnly and empty for a placement, auto seed defaults
    if (banners.length === 0 && params.activeOnly && params.placement) {
      await this.seedDefaultsIfEmpty();
      return AppBanner.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean() as any;
    }

    return banners as any;
  }

  static async getBannerById(id: string): Promise<IAppBanner> {
    const banner = await AppBanner.findById(id);
    if (!banner) {
      throw new NotFoundError(`Banner with ID ${id} not found`);
    }
    return banner;
  }

  static async createBanner(input: CreateBannerInput): Promise<IAppBanner> {
    if (!input.placement) {
      throw new BadRequestError('Placement is required');
    }

    if (!input.title && !input.imageUrl) {
      throw new BadRequestError('Either Title or Image URL is required');
    }

    if (input.sortOrder == null) {
      const highest = await AppBanner.findOne({ placement: input.placement.toLowerCase() })
        .sort({ sortOrder: -1 })
        .select({ sortOrder: 1 })
        .lean();
      input.sortOrder = highest ? (highest.sortOrder ?? 0) + 1 : 0;
    }

    const banner = new AppBanner({
      ...input,
      placement: input.placement.toLowerCase(),
      tone: input.tone || 'light',
      backgroundColor: input.backgroundColor || '#FFFFFF',
      actionType: input.actionType || 'none',
      isActive: input.isActive !== undefined ? input.isActive : true,
    });

    await banner.save();
    return banner;
  }

  static async updateBanner(id: string, input: Partial<CreateBannerInput>): Promise<IAppBanner> {
    const banner = await AppBanner.findById(id);
    if (!banner) {
      throw new NotFoundError(`Banner with ID ${id} not found`);
    }

    if (input.placement) banner.placement = input.placement.toLowerCase() as BannerPlacement;
    if (input.tag !== undefined) banner.tag = (input.tag ?? '').trim();
    if (input.eyebrow !== undefined) banner.eyebrow = (input.eyebrow ?? '').trim();
    if (input.title !== undefined) banner.title = (input.title ?? '').trim();
    if (input.subtitle !== undefined) banner.subtitle = (input.subtitle ?? '').trim();
    if (input.imageUrl !== undefined) banner.imageUrl = (input.imageUrl ?? '').trim();
    if (input.actionType !== undefined) banner.actionType = input.actionType;
    if (input.actionValue !== undefined) banner.actionValue = (input.actionValue ?? '').trim();
    if (input.actionParams !== undefined) banner.actionParams = input.actionParams;
    if (input.backgroundColor !== undefined) banner.backgroundColor = input.backgroundColor;
    if (input.tone !== undefined) banner.tone = input.tone;
    if (input.ctaLabel !== undefined) banner.ctaLabel = (input.ctaLabel ?? '').trim();
    if (input.sortOrder !== undefined) banner.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) banner.isActive = input.isActive;
    if (input.startDate !== undefined) banner.startDate = input.startDate;
    if (input.endDate !== undefined) banner.endDate = input.endDate;

    await banner.save();
    return banner;
  }

  static async deleteBanner(id: string): Promise<void> {
    const res = await AppBanner.findByIdAndDelete(id);
    if (!res) {
      throw new NotFoundError(`Banner with ID ${id} not found`);
    }
  }

  static async reorderBanners(orderedIds: string[]): Promise<void> {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new BadRequestError('orderedIds array is required');
    }
    const bulkOps = orderedIds.map((id, index) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { sortOrder: index } },
      },
    }));
    await AppBanner.bulkWrite(bulkOps);
  }

  static async seedDefaultsIfEmpty(): Promise<void> {
    const count = await AppBanner.countDocuments();
    if (count > 0) return;

    const initialBanners: Partial<IAppBanner>[] = [
      // Book Services initial slides
      {
        placement: 'book_services',
        title: 'Book Now offer — ₹100 off your first Book Now service',
        subtitle: 'Valid on your first scheduled home service booking.',
        imageUrl: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1080&q=80',
        actionType: 'tab',
        actionValue: 'book_now',
        actionParams: { kind: 'services_hub', tab: 'book_now' },
        ctaLabel: 'Book Now',
        backgroundColor: '#F7F5F2',
        tone: 'light',
        sortOrder: 0,
        isActive: true,
      },
      {
        placement: 'book_services',
        title: 'Hourly Helper — book a trusted helper from ₹99',
        subtitle: 'Pay by the hour for general home help, shifting, and chores.',
        imageUrl: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=1080&q=80',
        actionType: 'screen',
        actionValue: 'HourlyHelperScreen',
        ctaLabel: 'Book Hourly',
        backgroundColor: '#FFFFFF',
        tone: 'light',
        sortOrder: 1,
        isActive: true,
      },
      {
        placement: 'book_services',
        title: 'Refer & earn ExtraCoins',
        subtitle: 'Share your code and get reward coins on every completed booking.',
        imageUrl: 'https://images.unsplash.com/photo-1556742049-0a67c5574f73?w=1080&q=80',
        actionType: 'screen',
        actionValue: 'ReferralScreen',
        ctaLabel: 'Invite friends',
        backgroundColor: '#F7F5F2',
        tone: 'light',
        sortOrder: 2,
        isActive: true,
      },
      // ExtraMart initial slides
      {
        placement: 'extramart',
        title: 'Groceries, essentials & more',
        subtitle: 'Fresh picks, everyday essentials delivered to your doorstep.',
        imageUrl: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=1080&q=80',
        actionType: 'category',
        actionValue: 'fresh',
        ctaLabel: 'Shop Now',
        backgroundColor: '#ECFDF5',
        tone: 'light',
        sortOrder: 0,
        isActive: true,
      },
      {
        placement: 'extramart',
        title: 'Daily deals on staples',
        subtitle: 'Fill your cart with essentials at prices you will love.',
        imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1080&q=80',
        actionType: 'category',
        actionValue: 'grocery',
        ctaLabel: 'Explore deals',
        backgroundColor: '#FFFBEB',
        tone: 'light',
        sortOrder: 1,
        isActive: true,
      },
      {
        placement: 'extramart',
        title: 'Snacks & beverages',
        subtitle: 'Stock up on chips, drinks, and quick bites in minutes.',
        imageUrl: 'https://images.unsplash.com/photo-1599490659213-e2b9527bd087?w=1080&q=80',
        actionType: 'category',
        actionValue: 'snacks',
        ctaLabel: 'Shop snacks',
        backgroundColor: '#EFF6FF',
        tone: 'light',
        sortOrder: 2,
        isActive: true,
      },
    ];

    await AppBanner.insertMany(initialBanners);
  }
}
