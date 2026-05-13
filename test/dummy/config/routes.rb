Rails.application.routes.draw do
  root "widgets#index"
  resources :widgets, only: [:index, :show, :new, :create, :destroy] do
    post :close, on: :member
  end
end
