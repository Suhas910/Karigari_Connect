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

  MyListings: undefined;

  Capture: undefined;

  ImageReview: {
    draftId: string;
  };

  Speak: {
    draftId: string;
  };

  ConfirmDetails: {
    draftId: string;
    transcriptId: string;
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

  PublishExport: {
    listingId: string;
  };

  ArtisanProfile?: {
    userId?: number;
  };
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