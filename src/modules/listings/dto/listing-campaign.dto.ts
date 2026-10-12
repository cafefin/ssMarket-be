import { ApiProperty } from '@nestjs/swagger';
import type { Campaign } from '../../campaigns/campaign.entity.js';

/** The pre-order round a product belongs to, as far as a buyer needs it. */
export class ListingCampaignDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  orderDeadline!: string;

  @ApiProperty({ type: String, format: 'date', description: 'YYYY-MM-DD' })
  deliveryDate!: string;

  static from(campaign: Campaign): ListingCampaignDto {
    const dto = new ListingCampaignDto();
    dto.id = campaign.id;
    dto.title = campaign.title;
    dto.orderDeadline = campaign.orderDeadline.toISOString();
    dto.deliveryDate = campaign.deliveryDate;
    return dto;
  }
}
