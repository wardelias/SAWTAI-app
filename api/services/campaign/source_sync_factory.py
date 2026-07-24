from api.services.campaign.source_sync import CampaignSourceSyncService
from api.services.campaign.sources.csv import CSVSyncService
from api.services.campaign.sources.leads import LeadsSyncService
from api.services.campaign.sources.meta_instant_form import (
    MetaInstantFormSyncService,
)


def get_sync_service(source_type: str) -> CampaignSourceSyncService:
    """Returns appropriate sync service based on source type"""

    services = {
        "csv": CSVSyncService,
        "meta_instant_form": MetaInstantFormSyncService,
        "leads": LeadsSyncService,
    }

    service_class = services.get(source_type)
    if not service_class:
        raise ValueError(f"Unknown source type: {source_type}")

    return service_class()
