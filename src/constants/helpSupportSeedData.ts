export type HelpSupportVariant = 'customer' | 'helper';

export type HelpSupportFaqItem = {
  q: string;
  a: string;
};

export type HelpSupportCategorySeed = {
  categoryKey: string;
  title: string;
  subtitle: string;
  icon: string;
  items: HelpSupportFaqItem[];
  sortOrder: number;
};

export const HELP_SUPPORT_SEED_DATA: Record<
  HelpSupportVariant,
  HelpSupportCategorySeed[]
> = {
  customer: [
    {
      categoryKey: 'getting-started',
      title: 'Getting started',
      subtitle: 'How it works, post a work, availability',
      icon: 'Zap',
      sortOrder: 10,
      items: [
        {
          q: 'How does ExtraHand work?',
          a: 'Customers post a work request with their budget, Helpers apply for it, and both can negotiate the price. Once the customer selects a Helper and makes payment, the Helper arrives and completes the work.',
        },
        {
          q: 'How do I post work?',
          a: 'You can post work in two ways. Select a service from the home screen and the title and description will be pre-filled for you - just edit if needed, then add your address, date, time, and budget. Or tap "Post Work" to fill in all the details manually and submit.',
        },
        {
          q: 'Is ExtraHand available in my city?',
          a: 'ExtraHand is currently available in Hyderabad. We are working on expanding to more cities soon.',
        },
        {
          q: 'Is it free to use ExtraHand as a customer?',
          a: 'Yes, signing up and posting work on ExtraHand is completely free for customers. You only pay when you confirm a Helper for your work.',
        },
      ],
    },
    {
      categoryKey: 'booking',
      title: 'Booking & work',
      subtitle: 'Schedule, cancel, confirm',
      icon: 'Briefcase',
      sortOrder: 20,
      items: [
        {
          q: 'How do I book a Helper?',
          a: 'Post your work with a budget, review the offers from Helpers, discuss details if needed, and assign the Helper that best fits your requirement.',
        },
        {
          q: 'Can I schedule work in advance?',
          a: 'Yes, when posting work you can set your preferred date and time to schedule it for a later date.',
        },
        {
          q: 'How do I cancel or reschedule work?',
          a: "Go to your work tracking page and tap the Cancel button. You'll be asked to select a reason. To reschedule, contact your Helper through chat before the work begins.",
        },
        {
          q: "What if my Helper doesn't show up?",
          a: "If your Helper is not responding or doesn't show up, go to the work tracking page, cancel the work, and contact ExtraHand support. A refund will be processed as per the cancellation policy.",
        },
        {
          q: 'How do I know my work is confirmed?',
          a: 'Once you assign a Helper and complete payment, your work is confirmed and you will receive a notification.',
        },
      ],
    },
    {
      categoryKey: 'payments',
      title: 'Payments & refunds',
      subtitle: 'Charges, refunds, payment safety',
      icon: 'CreditCard',
      sortOrder: 30,
      items: [
        {
          q: 'What payment methods are accepted?',
          a: 'ExtraHand supports secure online payments through the platform. All payments must be made within the app - cash or outside payments are not permitted.',
        },
        {
          q: 'When do I get charged?',
          a: 'Payment is collected when you confirm and assign a Helper to your work.',
        },
        {
          q: 'How can I use ExtraCoins when paying for work?',
          a: 'You can apply ExtraCoins at checkout to reduce what you pay. The maximum you can use is up to 10% of the work amount for that booking.',
        },
        {
          q: 'How do I get a refund?',
          a: "Go to your work tracking page and tap the Cancel button. You'll be asked to select a reason for cancellation. Once submitted, the work will be cancelled and your refund will be processed based on ExtraHand's cancellation policy.",
        },
        {
          q: 'Is my payment information safe?',
          a: 'Yes, all payments are processed securely through the ExtraHand platform. We do not store your card details directly.',
        },
      ],
    },
    {
      categoryKey: 'safety',
      title: 'Safety & trust',
      subtitle: 'Verification, reporting, guarantee',
      icon: 'Shield',
      sortOrder: 40,
      items: [
        {
          q: 'Are Helpers background verified?',
          a: 'Helpers on ExtraHand must follow community guidelines and provide accurate information. Verified Helpers carry a verified badge on their profile for added trust.',
        },
        {
          q: 'What if I feel unsafe during work?',
          a: 'Your safety is our priority. If you feel unsafe at any point, end the work and contact ExtraHand support immediately.',
        },
        {
          q: 'How do I report a Helper?',
          a: 'You can report a Helper through the work page or by contacting support at support@extrahand.in with details of the issue.',
        },
        {
          q: "What is ExtraHand's safety guarantee?",
          a: "ExtraHand provides insurance coverage for accidental injury or property damage that occurs during work. Work outside the platform's guidelines is not covered.",
        },
      ],
    },
    {
      categoryKey: 'account',
      title: 'Account & profile',
      subtitle: 'Delete account, switch roles',
      icon: 'Settings',
      sortOrder: 50,
      items: [
        {
          q: 'How do I delete my account?',
          a: 'Go to your Account page, navigate to Privacy & Data, and you will find the option to delete your account from there.',
        },
        {
          q: 'How do I switch to Helper mode?',
          a: 'Go to your Account page and tap "Earn with ExtraHand" to set up your Helper profile and switch to Helper mode.',
        },
      ],
    },
  ],
  helper: [
    {
      categoryKey: 'getting-started',
      title: 'Getting started',
      subtitle: 'Availability, how it works for helpers',
      icon: 'Zap',
      sortOrder: 10,
      items: [
        {
          q: 'Is ExtraHand available in my city?',
          a: 'ExtraHand is currently available in Hyderabad. We are working on expanding to more cities soon.',
        },
        {
          q: 'How does ExtraHand work for Helpers?',
          a: 'Customers post tasks with their budget. As a Helper you can browse available tasks, apply for ones that suit your skills, negotiate the price with the customer, and once selected and payment is confirmed, you go and complete the work.',
        },
      ],
    },
    {
      categoryKey: 'finding-tasks',
      title: 'Finding & managing tasks',
      subtitle: 'Apply, negotiate, cancel, reschedule',
      icon: 'Briefcase',
      sortOrder: 20,
      items: [
        {
          q: 'How do I apply for a task?',
          a: 'Browse available tasks in the Find Work section. Tap on a task that matches your skills and submit your offer with your proposed price.',
        },
        {
          q: 'Can I negotiate the price with a customer?',
          a: 'Yes, after you apply for a task the customer can discuss and negotiate the price with you before confirming the assignment.',
        },
        {
          q: 'How do I cancel a task I accepted?',
          a: "Go to the task's tracking page and tap the Cancel button. You'll be asked to select a reason. Note that repeated cancellations may affect your profile and task requests.",
        },
        {
          q: 'How do I reschedule a task?',
          a: 'Contact the customer through the in-app chat before the task begins and agree on a new date and time.',
        },
      ],
    },
    {
      categoryKey: 'earnings',
      title: 'Earnings & payments',
      subtitle: 'Getting paid, fees, pricing',
      icon: 'CreditCard',
      sortOrder: 30,
      items: [
        {
          q: 'How do I get paid as a Helper?',
          a: 'Add your bank account details in your Helper profile. Once a task is completed, your earnings will be transferred to your bank account within 3-5 business days after the platform fee is deducted.',
        },
        {
          q: 'When is payment released?',
          a: 'Payment is released after the customer confirms task completion.',
        },
        {
          q: 'What is the ExtraHand service fee?',
          a: 'ExtraHand charges a platform service fee on each transaction. The exact fee will be shown before you confirm a task.',
        },
        {
          q: 'How do ExtraCoins limits work for customers and helpers?',
          a: 'Customers can use ExtraCoins up to 10% of work amount during payment. Helpers can use ExtraCoins up to 15% of platform fee while requesting payout.',
        },
        {
          q: 'Can I set my own price?',
          a: 'Yes, you can make an offer at your preferred price when applying for a task. Both you and the customer can negotiate before confirming.',
        },
      ],
    },
    {
      categoryKey: 'growing',
      title: 'Growing as a Helper',
      subtitle: 'More requests, update skills',
      icon: 'TrendingUp',
      sortOrder: 40,
      items: [
        {
          q: 'How do I increase my task requests?',
          a: 'Complete tasks on time, maintain good reviews, keep your profile updated with accurate skills, and respond quickly to offers.',
        },
        {
          q: 'How do I update my skills or location?',
          a: 'Go to your Helper profile in the Account section and edit your skills, service areas, and other details anytime.',
        },
      ],
    },
    {
      categoryKey: 'safety',
      title: 'Safety & trust',
      subtitle: 'Safety, community guidelines',
      icon: 'Shield',
      sortOrder: 50,
      items: [
        {
          q: 'What if I feel unsafe during a task?',
          a: 'Your safety is our priority. If you feel unsafe at any point, stop the task and contact ExtraHand support immediately.',
        },
        {
          q: 'What are the community guidelines I must follow?',
          a: "As a Helper you must be at least 18 years old, have valid working rights, provide accurate information, communicate respectfully, and follow ExtraHand's community guidelines at all times.",
        },
      ],
    },
    {
      categoryKey: 'account',
      title: 'Account & profile',
      subtitle: 'Delete account, switch roles',
      icon: 'Settings',
      sortOrder: 60,
      items: [
        {
          q: 'How do I delete my account?',
          a: 'Go to your Account page, navigate to Privacy & Data, and you will find the option to delete your account from there.',
        },
        {
          q: 'How do I switch back to Customer mode?',
          a: 'Go to your Account page and tap "Switch to Customer view" to return to Customer mode anytime.',
        },
      ],
    },
  ],
};
