// src/types/navigation.ts

import type { NavigatorScreenParams } from '@react-navigation/native';
import type { ListingState } from './contracts';

export type ArtisanTabParamList = {
  MyListings: undefined;
  InReview: undefined;
  Help: undefined;
  Profile: undefined;
};

export type ArtisanStackParamList = {
  SignIn: undefined;

  HomeTabs: NavigatorScreenParams<ArtisanTabParamList> | undefined;

  Capture: undefined;

  ImageReview: {
    draftId: string;
    reviewOnly?: boolean;
  };

  Speak: {
    draftId: string;
  };

  ConfirmDetails: {
    draftId: string;
    transcriptId?: string;
    declared_language?: string;
  };

  ArtisanExperience?: {
    draftId: string;
  };

  Price: {
    draftId: string;
  };

  SubmitApproval: {
    draftId: string;
  };

  ListingStatus: {
    listingId: string;
    state: ListingState;
  };

  ArtisanProfile: undefined;

  SupportThread: {
    messageId: string;
    initialTitle?: string;
  };

  ApprovedCraftDetail: {
    draftId: string;
  };

  PublishExport: {
    listingId: string;
  };
};

export type CoordinatorTabParamList = {
  Queue: undefined;
  Profiles: undefined;
  History: undefined;
  Account: undefined;
};

export type CoordinatorStackParamList = {
  CoordinatorTabs: NavigatorScreenParams<CoordinatorTabParamList> | undefined;

  CoordinatorDashboard?:
    | NavigatorScreenParams<CoordinatorTabParamList>
    | undefined;

  CraftReviewDetail: {
    listingId: string;
  };

  PublishExport: {
    listingId: string;
  };

  SupportThread: {
    messageId: string;
    initialTitle?: string;
  };

  ArtisanProfile?: {
    userId?: number;
  };

  CoordinatorProfile: undefined;

  ArtisanInquiriesList: undefined;
};

export type RootStackParamList = {
  Auth: undefined;

  ArtisanStack: NavigatorScreenParams<ArtisanStackParamList>;

  CoordinatorStack: NavigatorScreenParams<CoordinatorStackParamList>;

  RoleError: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}