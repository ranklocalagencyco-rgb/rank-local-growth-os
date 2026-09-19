// Schema.org type vocabulary shared by the extractor, the schema walker and the rules. Pure constants.

/** Schema.org types the product cares about, matched case-insensitively against every @type / itemtype seen. */
export const TRACKED_SCHEMA_TYPES = ["LocalBusiness", "Organization", "Service", "WebSite", "WebPage", "BreadcrumbList", "FAQPage", "Review", "AggregateRating"] as const;

/** LocalBusiness and its common schema.org subtypes as seen on trade/local sites. */
export const LOCAL_BUSINESS_TYPE = /^(?:LocalBusiness|HomeAndConstructionBusiness|RoofingContractor|Plumber|Electrician|GeneralContractor|HVACBusiness|HousePainter|Locksmith|MovingCompany|ProfessionalService|LegalService|Attorney|Dentist|Physician|MedicalBusiness|AutoRepair|AutoDealer|Restaurant|Store|FinancialService|RealEstateAgent|TravelAgency|SportsActivityLocation|HealthAndBeautyBusiness|BeautySalon|HairSalon|DaySpa|ChildCare|EmploymentAgency|AnimalShelter|LodgingBusiness|Hotel|FoodEstablishment|EntertainmentBusiness|GovernmentOffice|Library|ShoppingCenter|SelfStorage|TouristInformationCenter|RadioStation|TelevisionStation|InternetCafe|DryCleaningOrLaundry|Florist|GardenStore|HardwareStore|HomeGoodsStore|PetStore|Bakery|CafeOrCoffeeShop|BarOrPub|Winery|Brewery|Distillery|NightClub|Dentist|Optician|Pharmacy|VeterinaryCare|Cleaner|Contractor)$/i;
